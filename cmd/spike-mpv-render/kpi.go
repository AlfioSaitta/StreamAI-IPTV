// Pure-Go: nessun build constraint. Strutture KPI + serializzazione JSON
// usate sia dall'harness reale (mpv build) che dal test stub.
//
// Vedi docs/spike1-methodology.md sez. "Metriche raccolte".

package main

import (
	"encoding/json"
	"fmt"
	"io"
	"math"
	"runtime"
	"sort"
	"time"
)

// histogramBucketsMs è l'asse dei bucket per l'istogramma frame-time.
// La granularità è scelta per distinguere chiaramente i regimi:
//   - <=4 ms   = idle / GPU-bound veloce
//   - <=8 ms   = target 1080p60
//   - <=12 ms  = headroom 4K60
//   - <=14 ms  = target 4K60 (KPI cap)
//   - <=20 ms  = degrado tollerabile
//   - >20 ms   = drop probabile a 60 fps
var histogramBucketsMs = []float64{0, 2, 4, 6, 8, 10, 12, 14, 16, 20, 30, 60, 120}

// frameSample è una singola misura wall-clock end-to-end (render dispatch
// → glReadPixels return) in millisecondi.
type frameSample struct {
	dtMs float64
}

// kpiCollector raccoglie i sample di un run e produce il report JSON.
// Non-thread-safe: ogni run usa una sola goroutine (il main).
type kpiCollector struct {
	samples       []frameSample
	droppedFrames int
	startedAt     time.Time
	stoppedAt     time.Time
	clipURL       string
	fboWidth      int
	fboHeight     int
	hwdec         string
}

func newKPICollector(clipURL string, w, h int, hwdec string) *kpiCollector {
	return &kpiCollector{
		samples:  make([]frameSample, 0, 16384),
		clipURL:  clipURL,
		fboWidth: w,
		fboHeight: h,
		hwdec:    hwdec,
	}
}

// recordFrame registra un sample. dt è il delta wall-clock tra l'inizio
// del dispatch render mpv e il return di glReadPixels (o equivalente).
func (k *kpiCollector) recordFrame(dt time.Duration) {
	k.samples = append(k.samples, frameSample{dtMs: float64(dt.Microseconds()) / 1000.0})
}

func (k *kpiCollector) setDroppedFrames(n int) { k.droppedFrames = n }

func (k *kpiCollector) start() { k.startedAt = time.Now() }
func (k *kpiCollector) stop()  { k.stoppedAt = time.Now() }

// reportKPI è la shape persistita su `spike1-report.json`. Documentata
// nella tabella in `docs/spike1-methodology.md`.
type reportKPI struct {
	Hardware  reportHardware  `json:"hw"`
	Clip      string          `json:"clip"`
	FBO       reportFBO       `json:"fbo"`
	DurationS float64         `json:"duration_s"`
	Frames    int             `json:"frames"`
	FrameTime reportFrameTime `json:"frame_time_ms"`
	Dropped   reportDropped   `json:"dropped_frames"`
	HwdecUsed string          `json:"decoder_hwdec"`
	Result    string          `json:"result"` // pass | warn | fail
}

type reportHardware struct {
	CPU   string `json:"cpu"`
	GPU   string `json:"gpu"` // popolato dal chiamante (lettura `glGetString(GL_RENDERER)`)
	RAMGB int    `json:"ram_gb"`
	OS    string `json:"os"`
	Goarch string `json:"goarch"`
}

type reportFBO struct {
	Width  int    `json:"width"`
	Height int    `json:"height"`
	Format string `json:"format"`
}

type reportFrameTime struct {
	P50      float64   `json:"p50"`
	P95      float64   `json:"p95"`
	P99      float64   `json:"p99"`
	Max      float64   `json:"max"`
	Mean     float64   `json:"mean"`
	Buckets  []float64 `json:"histogram_buckets_ms"`
	Counts   []int     `json:"histogram_counts"`
}

type reportDropped struct {
	Count int     `json:"count"`
	Ratio float64 `json:"ratio"`
}

// finalize produce il report aggregato. Il chiamante riempie GPU/HwdecUsed.
func (k *kpiCollector) finalize() reportKPI {
	if k.stoppedAt.IsZero() {
		k.stop()
	}

	frameTimes := make([]float64, len(k.samples))
	for i, s := range k.samples {
		frameTimes[i] = s.dtMs
	}
	sort.Float64s(frameTimes)

	rep := reportKPI{
		Clip: k.clipURL,
		FBO: reportFBO{
			Width:  k.fboWidth,
			Height: k.fboHeight,
			Format: "RGBA8",
		},
		DurationS: k.stoppedAt.Sub(k.startedAt).Seconds(),
		Frames:    len(frameTimes),
		HwdecUsed: k.hwdec,
		Dropped: reportDropped{
			Count: k.droppedFrames,
			Ratio: ratio(k.droppedFrames, len(frameTimes)),
		},
		Hardware: reportHardware{
			Goarch: runtime.GOARCH,
			OS:     runtime.GOOS,
		},
	}

	if len(frameTimes) == 0 {
		rep.Result = "fail"
		return rep
	}

	rep.FrameTime = reportFrameTime{
		P50:     percentile(frameTimes, 0.50),
		P95:     percentile(frameTimes, 0.95),
		P99:     percentile(frameTimes, 0.99),
		Max:     frameTimes[len(frameTimes)-1],
		Mean:    mean(frameTimes),
		Buckets: append([]float64(nil), histogramBucketsMs...),
		Counts:  bucketCounts(frameTimes, histogramBucketsMs),
	}

	rep.Result = gradeResult(rep)
	return rep
}

func (k *kpiCollector) writeJSON(w io.Writer, gpu string) error {
	rep := k.finalize()
	if gpu != "" {
		rep.Hardware.GPU = gpu
	}
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	return enc.Encode(rep)
}

// gradeResult applica la decision matrix di docs/spike1-methodology.md.
// Soglie:
//   - 1080p (max(w,h) ≤ 1920): p95 ≤ 8.0 ms
//   - 4K    (max(w,h) >  1920): p95 ≤ 14.0 ms
//   - dropped ratio ≤ 0.005 in entrambi i casi
func gradeResult(rep reportKPI) string {
	target := 14.0
	if max(rep.FBO.Width, rep.FBO.Height) <= 1920 {
		target = 8.0
	}
	p95OK := rep.FrameTime.P95 <= target
	dropOK := rep.Dropped.Ratio <= 0.005

	switch {
	case p95OK && dropOK:
		return "pass"
	case !p95OK && !dropOK:
		return "fail"
	default:
		return "warn"
	}
}

// ---- helpers ---------------------------------------------------------------

func percentile(sorted []float64, p float64) float64 {
	if len(sorted) == 0 {
		return 0
	}
	idx := int(math.Ceil(p*float64(len(sorted)))) - 1
	if idx < 0 {
		idx = 0
	}
	if idx >= len(sorted) {
		idx = len(sorted) - 1
	}
	return sorted[idx]
}

func mean(xs []float64) float64 {
	if len(xs) == 0 {
		return 0
	}
	var s float64
	for _, v := range xs {
		s += v
	}
	return s / float64(len(xs))
}

func bucketCounts(values, edges []float64) []int {
	out := make([]int, len(edges))
	for _, v := range values {
		// Trova il primo edge >= v. Il bucket "edge[i]" rappresenta
		// "valori nell'intervallo (edge[i-1], edge[i]]".
		idx := sort.SearchFloat64s(edges, v)
		if idx >= len(out) {
			idx = len(out) - 1
		}
		out[idx]++
	}
	return out
}

func ratio(n, tot int) float64 {
	if tot == 0 {
		return 0
	}
	return float64(n) / float64(tot)
}

// formatPercent serializza ratio come "0.137%". Usato dai log human-friendly.
func formatPercent(r float64) string { return fmt.Sprintf("%.3f%%", r*100) }


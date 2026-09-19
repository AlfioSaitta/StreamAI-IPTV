// Costo e pacing del render software, misurati su libmpv reale.
//
// PERCHÉ QUESTO TEST ESISTE
//
// `mpv_render_context_render` blocca per default finché non è il momento di
// mostrare il frame (pacing sul tempo di presentazione). In un player embedded
// che disegna in un canvas quel blocco è un danno silenzioso: parka un
// goroutine e una connessione HTTP per ~33 ms per frame, e soprattutto fa
// sembrare "carico" quello che è soltanto attesa — anche al loop adattivo del
// frontend, che reagisce abbassando la cadenza su hardware che invece avrebbe
// margine.
//
// Il blocco non si vede in nessun log e non produce errori: l'unico modo per
// accorgersene è misurare, ed è quello che fa questo test.
//
// NON è un benchmark con soglie strette. Le differenze sotto ~20% non sono
// risolvibili su questa macchina (frequenza CPU variabile): le misure servono a
// distinguere "attesa di 30 ms" da "lavoro di 4 ms", non a confrontare filtri.
// Le prove di tuning dei filtri di scaling sono state fatte con questo harness
// e hanno dato esito nullo — vedi docs/stage-b-assessment.md §4-bis.
//
// Richiede `-tags mpv` e usa la sorgente sintetica `testsrc2` di lavfi: nessun
// display, nessuna rete, nessun audio. Se la sorgente non è disponibile il
// test si salta invece di fallire.
//
// Esecuzione:
//
//	export CGO_CFLAGS_ALLOW='-fno-strict-overflow|-fstack-clash-protection|-fcf-protection|-fno-omit-frame-pointer'
//	go test -tags 'gtk3 mpv' -run 'TestRender' -v ./internal/services/player/

//go:build mpv && (linux || darwin)

package player

import (
	"sort"
	"testing"
	"time"
)

const (
	// Sorgente 1080p a 30 fps: il caso tipico di un canale/film IPTV.
	renderTestSource = "av://lavfi:testsrc2=size=1920x1080:rate=30"
	// Intervallo fra due frame della sorgente (33.3 ms). Se il render bloccasse
	// sul tempo di presentazione, il costo medio per frame tenderebbe a questo
	// valore qualunque sia la velocità della macchina.
	renderTestFrameInterval = 100 * time.Millisecond / 3
)

// newRenderTestBackend prepara un backend con la sorgente sintetica e attende
// che produca contenuto reale (prima di allora il render restituisce un buffer
// nero e ogni misura sarebbe priva di significato).
func newRenderTestBackend(t *testing.T) backend {
	t.Helper()
	b := newBackend()
	if err := b.Load(renderTestSource, nil); err != nil {
		t.Skipf("sorgente di test non caricabile (%v): libmpv senza demuxer lavfi?", err)
	}
	deadline := time.Now().Add(15 * time.Second)
	for time.Now().Before(deadline) {
		if buf, _, _, err := b.RenderFrameEx(1280, 720); err == nil && frameHasContent(buf, 1280, 720) {
			return b
		}
		time.Sleep(150 * time.Millisecond)
	}
	_ = b.Close()
	t.Skip("la sorgente di test non ha mai prodotto un frame con contenuto")
	return nil
}

// frameHasContent distingue un frame renderizzato da un buffer vuoto.
func frameHasContent(buf []byte, w, h int) bool {
	if len(buf) != w*h*4 {
		return false
	}
	nonZero := 0
	for _, v := range buf {
		if v != 0 {
			nonZero++
			if nonZero > 1024 {
				return true
			}
		}
	}
	return false
}

// measureNewFrames misura il tempo per frame di `n` frame NUOVI. I frame
// riusati dalla cache (costo ~0) sono esclusi: non rappresentano il render.
func measureNewFrames(t *testing.T, b backend, w, h, n int) []float64 {
	t.Helper()
	if err := b.Play(); err != nil {
		t.Fatalf("play: %v", err)
	}
	time.Sleep(1500 * time.Millisecond) // primo frame a caldo

	out := make([]float64, 0, n)
	warm := 0
	deadline := time.Now().Add(60 * time.Second)
	for len(out) < n {
		if time.Now().After(deadline) {
			t.Fatalf("raccolti %d/%d campioni entro il timeout", len(out), n)
		}
		start := time.Now()
		buf, _, isNew, err := b.RenderFrameEx(w, h)
		elapsed := time.Since(start)
		if err != nil {
			t.Fatalf("RenderFrameEx: %v", err)
		}
		if !isNew {
			time.Sleep(2 * time.Millisecond)
			continue
		}
		if warm < 10 {
			warm++
			continue
		}
		if !frameHasContent(buf, w, h) {
			t.Fatalf("frame senza contenuto a %dx%d", w, h)
		}
		out = append(out, float64(elapsed.Microseconds())/1000.0)
	}
	return out
}

func meanP50(samples []float64) (float64, float64) {
	sorted := append([]float64(nil), samples...)
	sort.Float64s(sorted)
	var sum float64
	for _, s := range samples {
		sum += s
	}
	return sum / float64(len(samples)), sorted[len(sorted)/2]
}

// TestRenderDoesNotBlockForTargetTime è l'invariante vera: il costo per frame
// deve essere il LAVORO di conversione, non l'attesa del momento di
// presentazione. Senza BLOCK_FOR_TARGET_TIME=0 questo test fallisce con un
// costo medio vicino a 33 ms, indipendentemente dall'hardware.
func TestRenderDoesNotBlockForTargetTime(t *testing.T) {
	b := newRenderTestBackend(t)
	defer func() { _ = b.Close() }()

	const samples = 40
	times := measureNewFrames(t, b, 1280, 720, samples)
	mean, p50 := meanP50(times)

	t.Logf("1280x720 da sorgente 1080p30: media %.2f ms, p50 %.2f ms (%d frame nuovi)",
		mean, p50, len(times))

	// Soglia volutamente larga (il lavoro reale è ~4 ms su un laptop del 2022,
	// ma non vogliamo bocciare hardware lento): superarla significa che stiamo
	// misurando l'attesa del vsync, non la conversione.
	const maxMeanMs = 20.0
	if mean > maxMeanMs {
		t.Fatalf("costo medio per frame %.2f ms > %.0f ms: il render sta bloccando sul "+
			"tempo di presentazione (intervallo frame sorgente %.1f ms), "+
			"oppure la conversione software è satura su questa macchina",
			mean, maxMeanMs, float64(renderTestFrameInterval.Milliseconds()))
	}
}

// TestRenderCostPerFrame riporta il costo per frame alle risoluzioni di
// interesse. È diagnostico: nessuna soglia, nessun fallimento. Serve a sapere
// quanto margine ha la macchina prima di attribuire uno stutter al transport.
func TestRenderCostPerFrame(t *testing.T) {
	b := newRenderTestBackend(t)
	defer func() { _ = b.Close() }()

	for _, size := range []struct{ w, h int }{{960, 540}, {1280, 720}, {1920, 1080}} {
		times := measureNewFrames(t, b, size.w, size.h, 60)
		mean, p50 := meanP50(times)
		// Costo per frame in % di un core a 30 fps: è il numero che dice se il
		// render può competere con il decode su una CPU debole.
		coreAt30 := mean * 30 / 10.0
		t.Logf("%4dx%-5d media %5.2f ms  p50 %5.2f ms  (~%4.1f fps per core, %4.1f%% di un core a 30 fps)",
			size.w, size.h, mean, p50, 1000.0/mean, coreAt30)
	}
}

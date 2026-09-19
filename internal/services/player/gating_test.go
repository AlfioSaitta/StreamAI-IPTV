package player

import "testing"

// L'ottimizzazione "rendering su richiesta" può introdurre UN solo tipo di
// regressione grave: servire un frame vecchio quando mpv ne ha prodotto uno
// nuovo (video che si blocca) o quando non c'è nulla in cache (schermo nero).
// Questi test fissano l'invariante.
func TestShouldReuseFrame(t *testing.T) {
	tests := []struct {
		name          string
		sawSignal     bool
		pending       bool
		hasFrame      bool
		hasValidCache bool
		want          GatingDecision
	}{
		{"mai ricevuto un update: si renderizza sempre (comportamento pre-gating)", false, false, false, true, GatingRender},
		{"callback pendente: il frame nuovo va renderizzato", true, true, false, true, GatingRender},
		{"mpv riporta un frame nuovo: va renderizzato", true, false, true, true, GatingRender},
		{"callback e update insieme: va renderizzato", true, true, true, true, GatingRender},
		{"nessun frame nuovo e cache valida: si riusa", true, false, false, true, GatingReuse},
		{"nessun frame nuovo ma cache assente: si renderizza", true, false, false, false, GatingRender},
		{"cache non valida con frame nuovo: si renderizza", true, true, false, false, GatingRender},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := shouldReuseFrame(tc.sawSignal, tc.pending, tc.hasFrame, tc.hasValidCache)
			if got != tc.want {
				t.Fatalf("shouldReuseFrame(sawSignal=%v, pending=%v, hasFrame=%v, cache=%v) = %v, want %v",
					tc.sawSignal, tc.pending, tc.hasFrame, tc.hasValidCache, got, tc.want)
			}
		})
	}
}

// Il riuso non deve MAI avvenire se non abbiamo la prova che il meccanismo di
// notifica funziona: è la garanzia di non-regressione su piattaforme dove il
// callback di update non arriva.
func TestShouldReuseFrame_NeverReusesWithoutSignal(t *testing.T) {
	for _, pending := range []bool{false, true} {
		for _, hasFrame := range []bool{false, true} {
			for _, cache := range []bool{false, true} {
				if got := shouldReuseFrame(false, pending, hasFrame, cache); got == GatingReuse {
					t.Fatalf("riuso senza segnale (pending=%v hasFrame=%v cache=%v)", pending, hasFrame, cache)
				}
			}
		}
	}
}

// Percentili usati dal log periodico della pipeline di render.
func TestPercentiles(t *testing.T) {
	p50, p95 := percentiles(nil)
	if p50 != 0 || p95 != 0 {
		t.Fatalf("campione vuoto: p50=%v p95=%v, attesi 0", p50, p95)
	}

	// 1..100: p50 ≈ 50-ish, p95 ≈ 95-ish (indice arrotondato).
	samples := make([]float64, 0, 100)
	for i := 1; i <= 100; i++ {
		samples = append(samples, float64(i))
	}
	p50, p95 = percentiles(samples)
	if p50 < 50 || p50 > 51 {
		t.Fatalf("p50=%v, atteso ~50", p50)
	}
	if p95 < 95 || p95 > 96 {
		t.Fatalf("p95=%v, atteso ~95", p95)
	}

	// L'input non deve essere ordinato sul posto (è il campione dello stato).
	if samples[0] != 1 || samples[99] != 100 {
		t.Fatalf("percentiles ha modificato il campione di input")
	}
}

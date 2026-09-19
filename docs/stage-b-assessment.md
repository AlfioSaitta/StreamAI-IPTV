# Stage B — valutazione del transport di render (assessment 2026-09-18)

> Documento di riferimento per la decisione "implementare Stage B?" sul
> pipeline video di `internal/services/player/`.
> Stato: **Fase 0 + 1 implementate**; **Fase 2 (T1/GPU) e Fase 3 (surface
> nativa) deliberate ma rinviate** — non precluse (vedi §7).

---

## 0. TL;DR

| Domanda | Risposta |
|---|---|
| Il transport attuale è quello descritto nel piano (§4.3, "NV12/P010 zero-copy via shm")? | **No.** Il pipeline in produzione è *software* + HTTP loopback (vedi §2). |
| I criteri di accettazione 4K del piano sono soddisfatti? | **Non verificati e verosimilmente non soddisfatti**: SPIKE-1 chiude a `fail` a 4K (§3). |
| Vale la pena rifare il transport ora? | **No**, prima serve una misura affidabile (§3, §7). |
| Cosa è stato fatto invece? | **Fase 0** (strumentazione) + **Fase 1** (rendering su richiesta): eliminano il lavoro CPU sprecato *dentro* il transport attuale, senza toccarlo. |
| 4K futuro? | Non precluso: il confine di trasporto è già isolato dietro un'interfaccia sostituibile (§6, §7). |

---

## 1. Attenzione all'omonimia: due "Stage B"

Il repo usa la stessa etichetta per due cose diverse. Per evitare di
confondere "fatto" con "da fare":

| Nome | Significato | Dove | Stato |
|---|---|---|---|
| **Stage B (Fase 7.3)** | *Drop del player web legacy* (video.js/hls.js/mpegts.js rimossi, resta solo libmpv) | `docs/plan-go-wails-migration.md`, commit `01684c3` | ✅ **Completato** |
| **Stage B (questo doc)** | *Cambio del transport di render*: da conversione software + copia CPU a percorso GPU/surface nativa | piano §4.3 + commento `mpv_cgo.go:745-748` | 🚧 **Fase 0+1 fatte**, Fase 2-3 rinviate |

Nel codice il secondo è citato esattamente in `internal/services/player/mpv_cgo.go`
("il path HW-accelerated (MPV_RENDER_API_TYPE_OPENGL + DMA-BUF) arriva in
Step B della Fase 6.1 dopo SPIKE-3"): quella condizione **non si è mai
verificata**. Un tentativo è stato scritto e poi **rimosso**: commit
`d92246e` ("Opengl Tests", 640 righe: `render_gl.{c,go,h}`,
`transport_shm.go`) è stato annullato da `fea28e2` ("Revert Opengl
Tests"). Oggi quei file non esistono più: `internal/services/player/`
contiene solo `mpv_cgo.go` (software) + `callback_cgo.*` + `gating.go`.

---

## 2. Stato reale del pipeline (fatti, non ipotesi)

```
libmpv  ── hwdec=auto-copy-safe ──►  frame decodificato in RAM (NV12/P010)
   │                                   (gli HW frame GPU non sono consumabili
   │                                    dal renderer software: serve copy-back)
   ▼
mpv_render_context_render(MPV_RENDER_API_TYPE_SW)     mpv_cgo.go:843
   │   conversione colori + scaling in CPU  →  buffer RGBA w×h×4 (Go heap)
   │   costo misurato (sorgente 1080p30, Ryzen 7 6800H): 3.3 ms @540p ·
   │   4.4 ms @720p · 4.5 ms @1080p  — vedi §4-bis
   ▼
Service.AssetMiddleware   GET /player/frame?w=&h=      service.go:607
   │   stessa origine, loopback HTTP: 3.7 MB/frame @720p · 8.3 MB/frame @1080p
   ▼
useMpvCanvasRenderer: fetch → texSubImage2D → texture WebGL2 → <canvas>
```

Conseguenze dirette:

1. **Non è T1** (T1 = `glReadPixels` da un FBO su GPU) e **non è T2**
   (DMA-BUF). È un render *software*: la GPU non tocca il frame finché non
   arriva in `texSubImage2D`.
2. Il costo per frame è **CPU-lineare nell'ingresso** e non ha alcuna
   accelerazione. Misurato: 3.3 ms @540p, 4.4 ms @720p, 4.5 ms @1080p da
   sorgente 1080p — cioè ~10-14 % di un core a 30 fps. Il costo cresce poco
   con la risoluzione di *uscita*: domina la conversione colori sul frame in
   ingresso, non lo scaling (ed è il motivo per cui ottimizzare i filtri di
   scaling non serve a nulla, §4-bis).
3. Il transport HTTP loopback aggiunge una copia integrale del frame
   (kernel → Go → JS) e la `texSubImage2D` una seconda (JS → GPU).
4. Il vecchio `mpv_render_context_update()` non veniva mai consultato: il
   loop chiedeva un frame a cadenza fissa e *ogni* richiesta pagava la
   conversione, anche quando mpv non aveva prodotto nulla di nuovo.
5. `mpv_render_context_render` **bloccava** finché non era il momento di
   mostrare il frame: ~26 ms di attesa per frame che nessuno vedeva, scambiati
   per carico dal loop adattivo (§4-bis). Questa era la causa principale
   della fluidità deludente, non il costo di conversione.

Sopra i ~1080p il punto 2 da solo rende il 4K@60 fuori portata su hardware
modesto, **prima** di arrivare al problema di banda misurato da SPIKE-1.

---

## 3. SPIKE-1: cosa dice e cosa non dice

`docs/spike1-results-2026-05-22.md` (host: RTX 3050 Ti, libmpv 2.5.0,
sorgente sintetica `testsrc2`, quindi **nessun decoder esercitato**):

| Configurazione | fps | p50 | p95 | p99 | drop | esito |
|---|---|---|---|---|---|---|
| 1080p60 hwdec=no | 60.1 | 16.65 | 18.76 | 21.54 | 0/481 | warn |
| 1080p60 hwdec=auto | 60.1 | 16.66 | **16.95** | **18.04** | 0/481 | warn |
| 4K60 hwdec=no | 58.6 | 16.93 | 18.48 | 21.00 | 17/469 | fail |
| 4K60 hwdec=auto | 58.7 | 16.93 | 18.19 | 20.36 | 15/470 | fail |

Cosa se ne può trarre:

- ✅ `hwdec` funziona davvero (p95 1080p SW→HW: 18.76→16.95 ms, −9.7 %).
- ✅ A 4K il readback RGBA è `3840×2160×4 ≈ 33 MB/frame` ⇒ **~2 GB/s**
  sostenuti su PCIe per stare nei 16.67 ms: il bus è saturo e i drop
  (3.2-3.5 %) confermano che il collo di bottiglia non è il decoder.
- ❌ **Il p50 = 16.65 ms è esattamente 1/60 s**: la misura include l'attesa
  di vsync e non separa il lavoro GPU. Tutti i run finiscono in warn/fail
  *per costruzione* (soglia `p95 ≤ 8 ms`), anche quelli visivamente
  perfetti (60.1 fps, 0 drop). **I numeri di SPIKE-1 non sono utilizzabili
  come gate di accettazione** finché non si applica il refactor già
  indicato nel doc (glFenceSync + `eglSwapInterval(0)`).
- ❌ SPIKE-1 misura l'harness EGL/FBO + `glReadPixels`, cioè un transport
  **diverso** da quello poi messo in produzione (SW render). Non è una
  baseline del codice attuale.

**Conclusione metodologica:** l'unico dato robusto di SPIKE-1 è
qualitativo — *a 4K il trasferimento integrale del frame in CPU non è
sostenibile*. Qualsiasi decisione su "quale transport" va presa dopo aver
ri-misurato con il metodo corretto e su clip reali (BBB 1080p H.264 / 4K
HEVC; `scripts/spike1-bench.sh`, asset mai scaricato — vedi §7).

---

## 4. Perché il bersaglio è "hardware datato"

Su una macchina con 16+ core, 17 ms di conversione SW a 1080p possono
sembrare accettabili. Su un portatile con 2-4 core (o un mini-PC con iGPU
vecchia) no: la conversione compete con il decode, il compositing del
webview e la UI. Le mitigazioni già in produzione prima di questo lavoro:

- cap di cadenza a 30 fps sotto gli 8 core (`VideoPlayerNew.tsx:177-184`);
- budget di pixel a 1280×720 con preservazione dell'aspect ratio
  (`MAX_FRAME_PIXELS`, `useMpvCanvasRenderer.ts:121`);
- riduzione adattiva fino a 15 fps quando il frame costa troppo
  (`MIN_ADAPTIVE_FPS`, `useMpvCanvasRenderer.ts:111`);
- loop rallentato in pausa (mpv restituisce lo stesso frame).

Sono tutte **tope** sul sintomo: riducono la frequenza, non il costo per
frame. La Fase 1 attacca invece lo spreco strutturale.

---

## 4-bis. Il costo vero era l'attesa, non la conversione (misurato 2026-09-18)

Fase 0 non è servita solo a misurare: ha permesso di **falsificare** l'ipotesi
di partenza. L'indagine è andata così.

### Passo 1 — i filtri di scaling (ipotesi iniziale: erano il collo di bottiglia)

Il render software usa i default di mpv, che sono tarati per la massima
qualità: `scale=lanczos`, `dscale=hermite`, `cscale=""` (⇒ eredita lanczos per
il croma!), `correct-downscaling=yes`, `linear-downscaling=yes`. Con libmpv
linkata a libzimg quei filtri sono quelli *effettivamente* usati.

Implementato un sistema di profili (`quality`/`balanced`/`speed`), con test
sull'invariante e verifica che i pixel prodotti cambiassero davvero (impronta
SHA-256 del frame: i tre profili producono tre hash diversi ⇒ le opzioni sono
in vigore, non ignorate).

**Risultato: nullo.**

| Configurazione | tempo/frame |
|---|---|
| default mpv | 3.99 ms |
| `cscale=bilinear` | 4.28 ms |
| `cscale`+`sws-scaler`=bilinear | 4.71 ms |
| profilo aggressivo (tutto bilinear, correzioni off) | 4.08 ms |

Misure **interleaved** (round-robin fra le varianti, n=150 ciascuna) per
cancellare la deriva di frequenza della CPU. Le differenze sono dentro il
rumore e senza ordinamento coerente: su questa macchina **sotto ~20 % non è
risolvibile**. I run singoli, che sembravano mostrare −35 %, erano deriva
termica — motivo per cui la decisione è stata presa solo dopo il test
interleaved.

**Conseguenza:** il codice dei profili è stato **rimosso** invece di essere
spedito. Un'opzione che degrada la qualità dell'immagine senza un beneficio
misurabile è un costo netto. La spiegazione sta nel passo 2.

### Passo 2 — dove va davvero il tempo

Misurando il costo a risoluzioni di output diverse:

| output | tempo/frame | % di un core a 30 fps |
|---|---|---|
| 960×540 | 3.31 ms | 9.9 % |
| 1280×720 | 4.36 ms | 13.1 % |
| 1920×1080 | 4.53 ms | 13.6 % |

Il costo quasi **non dipende dalla risoluzione di output**: raddoppiando i
pixel da produrre si passa da 4.36 a 4.53 ms. Il lavoro dominante è la
conversione colori sul frame in **ingresso** (2 MP di YUV 4:2:0 → RGBA),
non lo scaling. Ecco perché cambiare il filtro di scaling non cambia nulla:
non è quello il costo.

### Passo 3 — la scoperta

Nelle prime misure *tutti* i profili costavano ~31 ms/frame, contro i ~4 ms
attesi. Non era carico: `mpv_render_context_render` **blocca per default**
finché non è il momento di presentare il frame (`BLOCK_FOR_TARGET_TIME`,
default `true`). A 30 fps significa ~26 ms di attesa per frame, invisibili in
qualsiasi log.

Perché è grave in questo player:

- ogni richiesta HTTP `/player/frame` teneva parkato un goroutine *e* una
  connessione per 26 ms per un lavoro di 4 ms;
- il loop adattivo del frontend misura il tempo di fetch e lo interpreta come
  carico: con 33 ms per frame "a 60 fps" scatta subito la riduzione fino a
  15 fps, **su hardware che aveva margine**. Un throttle auto-inflitto.
- le metriche di Fase 0 (`p50`/`p95` del costo per frame) erano pacing
  travestito da costo, quindi inadatte a decidere qualsiasi cosa.

**Correzione:** `MPV_RENDER_PARAM_BLOCK_FOR_TARGET_TIME = 0` nel render SW
(`mpv_cgo.go`). Il render ritorna il frame corrente subito; i frame non ancora
maturi arrivano come "nessun frame nuovo" e il gating li salta. La sincronia
A/V resta garantita da mpv (`video-sync=audio`), non dal blocco della call.

**Effetto misurato:** 31.3 ms → ~4.4 ms per frame nello stesso harness, un
fattore ~7 — enormemente sopra il rumore di misura, al contrario di tutto il
resto.

### Cosa resta

Il costo di conversione (~4 ms/frame, 13 % di un core a 30 fps) è **tutto**
ciò che rimane nel path SW, ed è CPU puro che non si può ottimizzare
ulteriormente da qui: l'unico modo per toglierlo è portarlo sulla GPU. Questo
rafforza la Fase 2 (`MPV_RENDER_API_TYPE_OPENGL`) con un argomento preciso:
sposta sulla GPU *la conversione colori*, che è il costo dominante — non lo
scaling, che è irrilevante.

### Test permanente

`internal/services/player/render_cost_test.go` (build tag `mpv`):

- `TestRenderDoesNotBlockForTargetTime` — invariante con soglia: se qualcuno
  dovesse reintrodurre il blocco, il costo medio per frame tornerebbe a ~33 ms
  e il test fallisce spiegando perché.
- `TestRenderCostPerFrame` — report diagnostico alle tre risoluzioni, per
  sapere quanto margine ha la macchina prima di attribuire uno stutter al
  transport.

Non gira in CI (richiede libmpv + lavfi): va eseguito a mano dopo modifiche al
path di render. Comando in testa al file.

---

## 5. Fase 0 + 1 — cosa è stato implementato

### Fase 0 — Strumentazione (per decidere con i dati, non con le impressioni)

- Callback di update di libmpv registrata dal backend:
  `mpv_render_context_set_update_callback` (trampolino C in
  `callback_cgo.c`, `//export goPlayerUpdateCallback` in `callback_cgo.go`)
  che alza un flag atomico.
- `RenderFrameEx` ritorna `(buf, seq, isNew, err)`; il middleware espone
  `X-Frame-Seq` e `X-Frame-New`.
- Contatori `renders`/`skips` (`RenderStats()`) e log aggregato ogni 30 s
  (`player: render pipeline stats`) con p50/p95 del costo per frame e
  percentuale di frame riusati — cioè *la metrica che dice se il transport
  software è il collo di bottiglia su quella macchina*.
- Harness di misura headless (`render_cost_test.go`), che ha permesso di
  scoprire il blocco sul tempo di presentazione (§4-bis) e di **respingere**
  un'ottimizzazione che sembrava ovvia ma non aveva effetto.

### Fase 1-bis — Rimozione del blocco sul tempo di presentazione

`MPV_RENDER_PARAM_BLOCK_FOR_TARGET_TIME = 0` nel render SW: da solo vale più
di tutto il resto messo insieme (31.3 → 4.4 ms per frame, §4-bis). È la
correzione che risponde alla richiesta originale "fluidità su hardware
datato", perché elimina sia l'attesa sia il throttle auto-inflitto del loop
adattivo.

### Fase 1 — Rendering su richiesta (demand-driven)

- Prima di ogni render si interroga `mpv_render_context_update()` e si
  consuma il flag del callback: se **non** c'è un frame nuovo e la cache è
  valida, si restituisce il frame precedente con `isNew=false` senza
  riconvertire nulla.
- Lato frontend, `X-Frame-New: 0` + `Content-Length: 0` → salto di
  trasferimento e di `texSubImage2D` (`useMpvCanvasRenderer.ts:337-360`).
- La politica è isolata in una funzione pura e testata
  (`gating.go` + `gating_test.go`): il riuso avviene **solo** se
  `sawSignal && !pending && !hasFrame && hasValidCache`.
- **Garanzia di non-regressione:** `sawSignal` diventa true solo dopo che
  il callback *o* `update()` hanno segnalato almeno un frame. Su una
  piattaforma dove la notifica non funziona, `sawSignal` resta false e il
  comportamento è identico a prima (render a ogni chiamata). Non è quindi
  possibile che l'ottimizzazione produca un frame mancante o uno stallo.

**Guadagno atteso:** il gating recupera esattamente la differenza fra
cadenza di richiesta e frame rate del contenuto. Contenuto 24p con loop a
30 fps → 20 % delle richieste non paga più né la conversione (7-17 ms) né
il trasferimento (3.7-8.3 MB). Contenuto 25p → ~17 %. Contenuto 30p (o
50/60p con cap a 60) → nessun guadagno, ed è corretto così: non c'è nulla
da riusare. In pausa il guadagno è totale.

### Verifica

| Gate | Esito |
|---|---|
| `go build -tags 'gtk3 mpv' ./...` | ✅ (con `CGO_CFLAGS_ALLOW` del `Taskfile.yml`) |
| `go build -tags 'gtk3' ./...` (stub) | ✅ |
| `go test -tags 'gtk3 mpv' ./internal/services/player/` | ✅ |
| `go test -tags 'gtk3' ./internal/...` | ✅ 0 FAIL |
| `go test -race` (player/proxy) | ✅ |
| `go vet -tags 'gtk3 mpv' ./internal/...` | ✅ |
| `npx tsc --noEmit` | ✅ 0 errori |
| `npx vitest run` | ✅ 219/219 |
| `go test -tags 'gtk3 mpv' -run TestRender ./internal/services/player/` | ✅ (misure §4-bis) |

Non coperto dai gate automatici: resa visiva reale e contatori di Fase 0 su
hardware datato (richiede una sessione con stream vero — vedi §7).

---

## 6. Perché la Fase 2 non è stata fatta adesso

**Fase 2 = T1/GPU (`MPV_RENDER_API_TYPE_OPENGL` + EGL surfaceless +
`glReadPixels`).** Sposta la conversione colori sulla GPU e toglie i
7-17 ms di CPU per frame; **mantiene però il trasferimento integrale del
frame verso la CPU**, che è esattamente ciò che SPIKE-1 ha misurato come
insostenibile a 4K (33 MB/frame, ~2 GB/s).

Costi e rischi:

- richiede EGL/GL e libmpv con supporto GL su Linux, Windows e macOS
  (nuove dipendenze di build e nuove varianti di fallback);
- il thread di render diventa un contesto GL: va gestita l'interazione con
  il ciclo di vita del webview e con la perdita del contesto;
- il guadagno è **reale ma parziale** (a 1080p su CPU deboli), e nessuno lo
  ha ancora misurato con metodo corretto: si rischia di aggiungere
  complessità a fronte di un beneficio non quantificato.

**Fase 3 = surface nativa** (mpv disegna in una finestra/child window, zero
copia reale). Elimina *tutto* il costo per frame, ma rompe due requisiti
non negoziabili del progetto: il PiP via DOM (`document.pictureInPictureElement`,
richiede che il video viva in un `<canvas>`/DOM) e l'OSD HTML sopra il
video. Non è quindi una "ottimizzazione", è un cambio di architettura del
player con impatto su feature dichiarate essenziali.

Per questo la decisione presa è: **Fase 0 + 1 ora; Fase 2/3 non ora, ma
senza precluderle.**

---

## 7. Cosa serve per riaprire la Fase 2 (gate predefiniti)

1. **Riparare la misura.** Applicare il refactor di SPIKE-1:
   `glFenceSync`/`glClientWaitSync` per isolare il tempo GPU e
   `eglSwapInterval(0)` nel bench offscreen; aggiornare le soglie.
   Senza questo, nessun confronto T0/T1 è credibile.
2. **Asset reali.** Eseguire `scripts/spike1-bench.sh` con clip BBB 1080p
   H.264 e 4K HEVC (asset mai scaricato finora). Misurare anche *con il
   transport di produzione*, non solo con l'harness.
3. **Classi di hardware.** Almeno: iGPU Intel UHD 620-class, un AMD
   Mesa/RADV, un NVIDIA. Il criterio "hardware datato" va definito lì.
4. **Soglie di accettazione proposte** (da confermare dopo il punto 1):
   - produzione frame CPU-side a 1080p: **p95 ≤ 8 ms**;
   - 4K: drop ratio **≤ 0.5 %** con hwdec attivo, altrimenti si resta al
     cap di risoluzione con avviso in UI (`StreamDiagnostics`);
   - nessuna regressione sui tempi di comando (Load/Play/Seek) sotto
     render concorrente.
5. Solo se T1 non basta a 4K: valutare T2 (DMA-BUF/EGLImage) — è la strada
   dei numeri, ma richiede supporto driver su tutte le piattaforme target
   e un percorso di fallback per i driver vecchi.

### Vincoli da non violare (mantengono la porta aperta)

- Il confine di trasporto è già un'**interfaccia** (`backend` in
  `service.go`) + un **middleware HTTP** (`AssetMiddleware`): sostituire il
  produttore di pixel non deve richiedere modifiche ai componenti UI.
- Il consumatore frontend (`useMpvCanvasRenderer`) riceve RGBA e deve
  restare ignaro di *come* i pixel sono prodotti: un futuro transport può
  cambiare la sorgente senza riscrivere il player.
- PiP e OSD HTML sopra il video restano requisiti: qualsiasi transport che
  li metta a rischio (surface nativa) va progettato per preservarli, non
  adottato e poi rattoppato.

---

## 8. Correzioni al piano (`docs/plan-go-wails-migration.md`)

Le voci seguenti vanno lette con lo stato reale qui documentato:

| Voce del piano | Affermazione | Stato reale |
|---|---|---|
| §10 "Playback 4K fluido" | ✅ Pieno — "NV12/P010 zero-copy via shm + shader WebGL2" | ⚠️ Zero-copy **non implementato**: il path è SW + HTTP loopback (§2) |
| §11 "Qualità 4K (vincolo §4.8)" | ☑ dropped ≤ 0.5 % @4K@60 | ⚠️ **Non verificato**; SPIKE-1 (transport diverso, metriche vsync-polluted) chiude a `fail` (§3) |
| §11 "Soak test 4K notturno verde" | ☑ | ⚠️ Nessun referto disponibile nel repo |
| §2.1 razionale backend D | "con transport shared-memory zero-copy il path regge 4K@60 su HW modesto" | ⚠️ Premessa non realizzata → il razionale resta valido per codec/PiP/ASS, non per le performance 4K |
| Fase 6.1 "Step B dopo SPIKE-3" | condizione di sblocco | 🚧 SPIKE-3 non eseguito; `d92246e` tentato e revertito in `fea28e2` |

Questo non invalida la scelta architetturale (backend D resta l'unica
opzione che soddisfa codec + PiP + OSD), ma sposta il 4K da "fatto" a
**obbiettivo con gate misurabile**.

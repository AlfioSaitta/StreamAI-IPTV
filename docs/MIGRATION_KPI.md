# 📊 Migration KPI Baseline — Electron 1.x → Wails v3 2.0.0

> **Status (2026-09-18): la baseline v1 non è più ottenibile.** Electron è
> stato rimosso dal progetto (Fase 7.3), quindi le colonne "Valore" riferite
> alla build Electron 1.x non sono più raccoglibili e il confronto
> before/after previsto in origine non è riproducibile.
>
> Questo file va quindi usato come **modulo di accettazione v2.0.0**: le
> misure si raccolgono sulla build Wails corrente e si confrontano con i
> criteri di §11 di [`plan-go-wails-migration.md`](plan-go-wails-migration.md),
> non con un baseline Electron.
>
> Compilare un blocco per OS sulle build `streamai-iptv_${version}_${distro}_x86_64.rpm`
> (`npm run dist:linux`) e sugli installer Windows/macOS.

---

## Linux — Baseline (Electron 1.x)

**Hardware di riferimento:**
- CPU: `<es. AMD Ryzen 7 5800X / Intel i7-12700K>`
- GPU: `<es. NVIDIA RTX 3060 / Intel UHD 770 / AMD RX 6700>`
- RAM: `<GB>`
- Storage: `<NVMe / SATA SSD>`
- Distro: `<es. openSUSE Tumbleweed 20260516>`
- Kernel: `<uname -r>`

**Software di riferimento:**
- Electron version: `<package.json electron>`
- Build: `streamai-iptv_${version}_${distro}_x86_64.rpm`
- Stream di test: `<URL HLS H.264 1080p>`, `<URL HLS HEVC 4K>`, `<URL HLS AV1 4K>`

| Metrica | Valore | Note |
|---|---|---|
| Dimensione `.deb` | TBD MB | |
| Dimensione `.rpm` | TBD MB | |
| Dimensione `.pkg.tar.zst` | TBD MB | |
| Dimensione installato (`du -sh /opt/StreamAI`) | TBD MB | |
| RAM idle (finestra aperta) | TBD MB | RSS via `pmap -x $(pidof streamai)` |
| RAM con stream HLS 1080p H.264 | TBD MB | |
| RAM con stream HLS HEVC 4K | TBD MB | |
| RAM con stream AV1 4K | TBD MB | |
| Tempo avvio cold-start | TBD s | da exec a window visible |
| TTFF stream HLS H.264 1080p | TBD ms | dal click a primo frame visibile |
| TTFF stream HLS HEVC 4K | TBD ms | |
| Dropped frame % HEVC 10-bit 4K@60 HW | TBD % | sessione 10 min |
| Dropped frame % AV1 4K@60 HW | TBD % | sessione 10 min |
| AV-sync drift medio (HLS live HEVC 4K, 1h) | TBD ms | `mpv --term-osd-bar` reference, o video.js stats |
| AV-sync drift peak (HLS live HEVC 4K, 1h) | TBD ms | |
| CPU% medio playback HEVC 4K HW | TBD % | `top -p $(pidof streamai)` su 5 min |
| CPU% medio playback AV1 4K HW | TBD % | |
| Codec supportati verificati | H.264 ☐ · HEVC ☐ · AV1 ☐ · AC3 ☐ · EAC3 ☐ · Opus ☐ | |

---

## Windows — Baseline (Electron 1.x)

> ⚠️ Electron `1.x` **non era distribuito ufficialmente** su Windows.
> Build locale manuale via `electron-builder` solo per riferimento KPI.

**Hardware di riferimento:** TBD
**OS:** Windows 10 21H2 / Windows 11 23H2
**Build:** unsigned local Electron

| Metrica | Valore | Note |
|---|---|---|
| Dimensione installer .exe | TBD MB | |
| Dimensione installato | TBD MB | |
| RAM idle | TBD MB | Task Manager → "Working Set" |
| RAM HLS 1080p H.264 | TBD MB | |
| RAM HLS HEVC 4K | TBD MB | richiede HEVC Video Extensions Store ($0.99) — NON disponibile out-of-the-box |
| RAM AV1 4K | TBD MB | richiede AV1 Video Extension |
| Tempo avvio cold-start | TBD s | |
| TTFF HLS H.264 | TBD ms | |
| HEVC playback funziona out-of-the-box? | ❌ no (richiede extension Microsoft Store) | scoglio risolto da libmpv post-migrazione |
| AV1 playback funziona out-of-the-box? | ❌ no | idem |

---

## macOS — Baseline (Electron 1.x)

> ⚠️ Electron `1.x` **non era distribuito ufficialmente** su macOS.
> Build locale manuale via `electron-builder` solo per riferimento KPI.

**Hardware di riferimento:** TBD
**OS:** macOS 13 Ventura / macOS 14 Sonoma
**Build:** unsigned local Electron (Gatekeeper warning atteso)

| Metrica | Valore | Note |
|---|---|---|
| Dimensione DMG | TBD MB | |
| Dimensione installato (`.app`) | TBD MB | |
| RAM idle | TBD MB | Activity Monitor → "Real Mem" |
| RAM HLS 1080p H.264 | TBD MB | |
| RAM HLS HEVC 4K | TBD MB | HEVC HW via VideoToolbox ok |
| Tempo avvio cold-start | TBD s | |
| TTFF HLS H.264 | TBD ms | |

---

## Note metodologiche

- **Cold-start** = chiusura completa app + svuotamento page cache (`echo 3 > /proc/sys/vm/drop_caches` su Linux) + lancio + cronometro fino a primo frame UI renderizzato.
- **TTFF** = dal click "Play canale" a primo frame video visibile (non al primo network byte).
- **RAM** = working-set / RSS, non virtual size.
- **Dropped frames** = da `mpv` property `frame-drop-count`, esposta nel pannello Diagnostica Stream (`components/player/StreamDiagnostics.tsx`). Nota: il player web (`HTMLVideoElement`, `chrome://media-internals`) non esiste più — il riferimento a Electron è stato rimosso.
- **AV-sync drift** = differenza tra timestamp audio e video clock; letto direttamente da `mpv` property `avsync`.
- **Costo per frame del render** = `go test -tags 'gtk3 mpv' -run TestRender ./internal/services/player/` (headless, nessun display richiesto; numeri di riferimento in [`stage-b-assessment.md`](stage-b-assessment.md) §4-bis). In sessione live: log `player: render pipeline stats` ogni 30 s.
- **Pacing del render** = non deve superare l'intervallo di frame della sorgente: se il costo per frame si avvicina a 33 ms a 30 fps, il blocco sul tempo di presentazione è tornato (guard: `TestRenderDoesNotBlockForTargetTime`).
- **Sessioni "live 1h"** = stream IPTV reale (preferito) o registrazione locale loopata con `ffmpeg -stream_loop -1`.

Tutti i numeri "TBD" vanno compilati nella Fase 0 prima di iniziare il porting (vedi roadmap §6 Fase 0).


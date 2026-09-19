# StreamAI IPTV — Piano Strategico & Roadmap v2.0

> **Documento unico e canonico.** Sostituisce tutte le versioni precedenti.
> Focalizzato sul post-migrazione **Wails v3** e sul mantenimento dell'eccellenza su **Android**.

**Stato attuale:** Final Packaging (2026-05-26)
**Target:** Versione 2.0.0 (Stabile) e Roadmap 2.1+

---

## 📊 1. Stato di completamento globale

| Area | Stato | Note |
|---|---|---|
| **Desktop Runtime** | ✅ | Migrazione Electron → Wails v3 completata. |
| **Player Video** | ✅ | libmpv + WebGL2 attivo su Desktop. |
| **Data Migration** | ✅ | Recupero profili da Electron v1 a Wails v2 attivo. |
| **Networking** | ✅ | Proxy IPTV same-origin e discovery Go completati. |
| **Android** | ✅ | Allineamento feature v2.0 completato (Media3 1.10.1). |
| **Windows/macOS** | 🚧 | Packaging e integrazioni OS specifiche in corso. |

---

## 🚀 2. Fase 9 — Consolidamento Cross-Platform (Priorità P0)

L'app è ora stabile su Linux. Dobbiamo garantire la stessa qualità su Windows e macOS.

### 9.1 Windows Integration (P0)
- [🚧] **WIN-POWERSAVE** — Implementare `SetThreadExecutionState` (Go).
- [🚧] **WIN-MEDIAKEYS** — Implementare bridge SMTC (System Media Transport Controls) (Go).
- [🚧] **WIN-NOTIF** — Implementare notifiche Toast native (Go).
- [🚧] **WIN-PKG** — Configurazione pipeline NSIS/nfpm per `.exe`.

### 9.2 macOS Integration (P0)
- [🚧] **MAC-POWERSAVE** — Implementare `IOPMAssertion` (Go).
- [🚧] **MAC-MEDIAKEYS** — Implementare `MPNowPlayingInfoCenter` (Go).
- [🚧] **MAC-NOTIF** — Implementare notifiche native (Go).
- [🚧] **MAC-PKG** — Configurazione bundle `.app` e `.dmg`.

---

## 🎬 3. Fase 11 — Player & Rendering Avanzato (Priorità P1)

Ottimizzazioni per contenuti 4K e miglioramento della gestione tracce.

### 11.1 Zero-copy Rendering (SPIKE-5)

> ⚠️ **Stato e analisi aggiornata: [`stage-b-assessment.md`](stage-b-assessment.md).**
> Il transport attuale è *software* (`MPV_RENDER_API_TYPE_SW` + HTTP
> loopback) e a 4K il trasferimento integrale del frame in CPU non è
> sostenibile. **Fase 0** (strumentazione: contatori render/skip, p50/p95
> del costo per frame, `player: render pipeline stats` ogni 30 s) e
> **Fase 1** (rendering su richiesta: nessuna riconversione quando mpv non
> ha un frame nuovo, con garanzia di non-regressione testata in
> `gating_test.go`) sono **✅ fatte (2026-09-18)**.
>
> **La misura ha inoltre trovato e corretto il costo dominante**, che non era
> dove lo si cercava: `mpv_render_context_render` bloccava ~26 ms per frame in
> attesa del tempo di presentazione (ora disattivato con
> `BLOCK_FOR_TARGET_TIME=0`) — 31 ms → 4.4 ms per frame misurati. Il tuning
> dei filtri di scaling è stato provato e **respinto**: esito nullo, il costo
> è la conversione colori in ingresso. Dettagli in
> [`stage-b-assessment.md`](stage-b-assessment.md) §4-bis. Le voci sotto
> restano aperte e subordinate a un gate di misura — vedi il doc §7.

- [ ] **Linux**: Implementare rendering via DMA-BUF (EGL_EXT_image_dma_buf_import) per evitare il passaggio dei frame dalla CPU (RGBA buffer).
- [ ] **Windows**: Valutare D3D11 sharing se possibile via Wails/WebView2.
- [🚧] **Stats**: frame drop reali già esposti da mpv (`hwdec-current`, `frame-drop-count`) nella Diagnostica Stream; i contatori *della pipeline di render* (Fase 0) sono al momento solo nel log Go — resta da esporli in `StreamDiagnostics`.

### 11.2 Gestione Tracce & Sottotitoli
- [✅] **Sideload**: Migliorata l'UI per il caricamento di sottotitoli esterni (.srt/.vtt) inviandoli direttamente a MPV.
- [✅] **Sync**: Garantito che il cambio traccia audio sia istantaneo e riflesso correttamente nell'OSD.
- [ ] **Miglioramento OSD**: Aggiungere anteprime dei frame sulla timeline (se MPV lo permette via cache veloce).

---

## 🤖 4. Fase 12 — Integrazione AI Gemini (Priorità P1)

StreamAI deve onorare il suo nome con feature intelligenti.

- [ ] **AI Recommender**: Rifattorizzare `AIRecommender.tsx` per usare i nuovi binding Wails se necessario (o restare in JS per portabilità).
- [ ] **Smart Search**: Implementare ricerca semantica sui canali ("Trova canali di cucina italiana") usando embeddings (opzionale).
- [ ] **Content Summary**: Generazione di riassunti per trame di film/serie via Gemini.

---

## ♻️ 5. Fase 13 — Refactoring & Qualità (Priorità P2)

Ridurre il debito tecnico accumulato durante la migrazione veloce.

- [✅] **REF-1.a**: Ridotto `VideoPlayerNew.tsx` (>1500 righe) estraendo `PlayerControls`, `PlaylistSidebar` e `SettingsOverlay`.
- [✅] **REF-1.b**: Pulizia completa dei residui Electron nel frontend (file `.js` inutilizzati, rami `if (isElectron)` rimasti).
- [ ] **P7.1 Test**: Aumentare la copertura dei test Go per i servizi core (Proxy, Player, Migration) al 70%.

---

## 📦 6. Fase 14 — Distribution & CI/CD (Priorità P1)

- [ ] **Auto-update**: Implementare un sistema di aggiornamento automatico sicuro (Wails v3 built-in o custom).
- [🚧] **Windows/macOS CI**: Configurare GitHub Actions per produrre artefatti Windows e macOS firmati.

---

## 🧭 Roadmap Temporale (Giugno - Agosto 2026)

1. **Giugno (Settimana 1-2)**: Windows & macOS baseline (MediaKeys + Packaging).
2. **Giugno (Settimana 3-4)**: QA Cross-platform e Release 2.0.0 Stabile.
3. **Luglio**: Ottimizzazioni 4K (Zero-copy) e Refactoring UI.
4. **Agosto**: Nuove feature AI e Sync Cloud (BYOC).

---

## 📈 Metriche di Successo v2.0
- **Crash rate**: < 0.1% delle sessioni.
- **Startup time**: < 1s su tutte le piattaforme Desktop.
- **CPU Usage (Idle/Playback)**: < 2% / < 15% (su hardware moderno con accelerazione).
- **Zero data loss**: 100% di successo nella migrazione da v1.
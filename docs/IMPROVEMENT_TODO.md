# StreamAI IPTV — TODO operativa v2.0

> **File companion di [`IMPROVEMENT_PLAN.md`](IMPROVEMENT_PLAN.md).**
> Contiene i task aperti per la versione 2.0 stabile e le successive.

---

## 🚀 Fase 9 — Consolidamento Cross-Platform (P0)

### 9.1 Windows
- [ ] **WIN-POWERSAVE** — Implementare `SetThreadExecutionState` (Go).
- [ ] **WIN-MEDIAKEYS** — Implementare bridge SMTC (Go).
- [ ] **WIN-NOTIF** — Implementare notifiche Toast native (Go).
- [ ] **WIN-PKG** — Configurazione pipeline NSIS/nfpm per `.exe`.

### 9.2 macOS
- [ ] **MAC-POWERSAVE** — Implementare `IOPMAssertion` (Go).
- [ ] **MAC-MEDIAKEYS** — Implementare `MPNowPlayingInfoCenter` (Go).
- [ ] **MAC-NOTIF** — Implementare notifiche native (Go).
- [ ] **MAC-PKG** — Configurazione bundle `.app` e `.dmg`.

---

## 🎬 Fase 11 — Player & Rendering Avanzato (P1)

- [ ] **MPV-ZERO-COPY** — Implementare DMA-BUF rendering su Linux (Zero-copy).
- [✅] **MPV-SIDELOAD-SUBS** — UI/UX per caricamento sottotitoli esterni.
- [✅] **MPV-TRACK-SYNC** — Verifica integrità cambio tracce audio/sub istantaneo.
- [ ] **MPV-TIMELINE-PREVIEW** — Anteprima frame su hover timeline (opzionale).

---

## 🤖 Fase 12 — Integrazione AI Gemini (P1)

- [ ] **AI-REF** — Rifattorizzazione `AIRecommender.tsx` (binding Wails).
- [ ] **AI-SEARCH** — Implementazione ricerca semantica (embeddings).
- [ ] **AI-SUMMARY** — Riassunti trame via Gemini.

---

## ♻️ Fase 13 — Refactoring & Qualità (P2)

- [✅] **REF-PLAYER-UI** — Splitting `VideoPlayerNew.tsx` in sotto-componenti.
- [✅] **PURGE-ELECTRON** — Rimozione definitiva rami di codice `if (isElectron)`.
- [ ] **TEST-GO-70** — Aumento copertura test Go al 70%.

---

## 📦 Fase 14 — Distribution & CI/CD (P1)

- [ ] **AUTO-UPDATE** — Sistema di aggiornamento automatico sicuro.
- [ ] **CI-CROSS** — GitHub Actions per Windows/macOS.

---

## 📡 Varie

- [ ] **CAST-SEEK** — Implementare comando `Seek` nel servizio `cast` (`Fase 3-bis` del piano di migrazione).
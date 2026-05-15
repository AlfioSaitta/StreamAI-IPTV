# StreamAI IPTV — Piano consolidato di miglioramenti, ottimizzazioni e roadmap

> **Documento unico e canonico.** Consolida i precedenti
> `IMPROVEMENT_PLAN.md` (P0-P8) e `IMPROVEMENT_PLAN_V2.md` (URG-1, UI-1, B-K).
> I file separati sono stati rimossi: questo è l'unico piano valido.
>
> **Ultimo aggiornamento:** 2026-05-15
> **Baseline reale (da `package.json`):** React **19.2.6**, Vite 5,
> Electron 37, Capacitor 7, Video.js 8.23, hls.js 1.5, mpegts.js 1.7,
> `@google/genai` 1.34, TypeScript strict, Tailwind CSS, Vitest 3.2.
>
> **File chiave:** `App.tsx`, `main.js`, `preload.js`,
> `components/VideoPlayerNew.tsx`, `services/xtream.ts`,
> `services/deviceDiscovery.ts`, `services/advertisingService.js`,
> `services/geminiService.ts`, `services/nativeVideoPlayer.ts`,
> `services/streamInfo/`, `vite.config.ts`.

---

## 📋 Indice

- [0. Convenzioni di gestione del piano](#0-convenzioni-di-gestione-del-piano)
- [📊 1. Stato di completamento globale](#-1-stato-di-completamento-globale-2026-05-15)
- [🐞 2. BUG-1: sezione "Films" sempre vuota](#-2-bug-1-sezione-films-sempre-vuota)
- [🚨 3. URG-1: Seek VOD bloccante](#-3-urg-1-seek-vod-bloccante)
- [🎨 4. UI-1: Design System v1](#-4-ui-1-design-system-v1)
- [5. Roadmap prioritaria P0-P8](#5-roadmap-prioritaria-p0-p8)
- [6. Debt tecnico ad alto impatto (B)](#6-debt-tecnico-ad-alto-impatto-b)
- [7. UX gap residui (C)](#7-ux-gap-residui-c)
- [8. Nuove feature ad alto valore (D)](#8-nuove-feature-ad-alto-valore-d)
- [9. Performance avanzata (E)](#9-performance-avanzata-e)
- [10. Affidabilità e osservabilità (F)](#10-affidabilità-e-osservabilità-f)
- [11. Qualità del codice e DX (G)](#11-qualità-del-codice-e-dx-g)
- [12. Quick wins (K)](#12-quick-wins-k)
- [13. Roadmap consigliata (12 settimane)](#13-roadmap-consigliata-12-settimane)
- [14. Metriche di successo](#14-metriche-di-successo)
- [15. Note di sicurezza/privacy](#15-note-di-sicurezzaprivacy)
- [16. Comandi utili](#16-comandi-utili)
- [17. Checklist pre-merge](#17-checklist-pre-merge)

---

## 0. Convenzioni di gestione del piano

Stati delle checkbox:

- `[ ]` Da fare.
- `[x]` Completato.
- `[ ] Da verificare:` implementato ma non ancora testato su piattaforma target.
- `[ ] Bloccato:` richiede decisione, device fisico, credenziali o dipendenza esterna.
- `[ ] Opzionale:` miglioramento utile ma non prioritario.

Legenda macro: ✅ completato · 🚧 in corso · ⏳ pianificato · ❌ scartato.

Per ogni tranche idealmente chiudere con:

- [ ] `npm run typecheck` OK.
- [ ] `npm run test:run` OK.
- [ ] `npm run build` OK.
- [ ] `npm run check` OK (typecheck + test:run + build).
- [ ] Smoke test Electron se tocca `main.js`, `preload.js`,
  `services/advertisingService.js` o networking.
- [ ] Build/test Android se tocca `capacitor.config.ts`, `android/`,
  `services/nativeVideoPlayer.ts` o player mobile.
- [ ] Aggiornamento README/AGENTS/copilot-instructions se cambia
  comportamento utente o setup.

---

## 📊 1. Stato di completamento globale (2026-05-15)

| Area | Stato | Note |
| ---- | ----- | ---- |
| 🐞 **BUG-1 Films sempre vuota** | ✅ Completato | Vedi §2 — cache hardening + retry mirato + UI feedback + 15 test |
| 🚨 URG-1 Seek VOD bloccante | ✅ 3/4 livelli | Livello 4 (Range proxy Electron) opzionale |
| 🎨 UI-1 Design System v1 | ✅ 100% | DS v1 + migrazione + accessibilità, 0 occorrenze red/purple |
| P0 Sicurezza runtime | 🚧 | `npm audit` triage, hardening WS remote, IPC validation aperti |
| P1 Bundle iniziale | ✅ | 580 → 146 kB gzip (lazy + auto split) |
| P2 Player Desktop/Android | ✅ | Error handling, PiP native, fallback codec |
| P3 Casting/discovery | ✅ codice | Verifica device fisici aperta |
| P4 UX TV/Android | ✅ codice | Verifica telecomando/TV box reale aperta |
| P5 AI + metadata | ✅ | Cache TTL, fuzzy match, prompt contestuali |
| P6 Catalogo + immagini | ✅ | Indice, virtualizzazione, Cache API + LRU |
| P7 Test automatici | 🚧 | 161/161 verdi, coverage parziale |
| P8 Feature future | ⏳ | Companion remote, diagnostica, BYOC, parental |
| B.1 Refactor `VideoPlayerNew` | ✅ | 1542 → 973 righe |
| B.2 Decomposizione `streamInfoService` | ✅ | 2018 → 1313 righe |
| B.3 i18n lazy | ✅ | 11 chunk per-lingua |
| B.4 Routing dichiarativo (`useBackStack`) | ✅ | |
| B.5 Upgrade React 19 | ✅ | `useActionState`, `useTransition` |
| C.1 Cheatsheet shortcut | 🚧 | overlay ok, onboarding al primo avvio mancante |
| C.2 Onboarding profilo | ✅ | wizard 3 step + test Xtream + import M3U remoto |
| C.3 Cmd+K palette | ✅ | recent searches + filtri chip + filtri avanzati |
| C.4 Continua a guardare + auto-next | ✅ | soglia + countdown + toggle per-tipo (film/serie) |
| D.1 EPG (mini + Guide + reminder) | ✅ | Fasi 1-3 |
| D.4 Sottotitoli MVP (SRT/VTT sideload) | 🚧 | manca HLS embed + OpenSub |
| D.5 Sleep timer | ✅ | preset + fine programma |
| D.10 Tema OLED | ✅ | mancano light/auto |
| E.1 Bundle iniziale | ✅ | 580 → 146 kB gzip |
| E.5 Cache API + gzip TMDB | ✅ | |
| F.3 Health-check Xtream | ✅ | badge + alert 7gg |
| G.1 vitest + test moduli puri | 🚧 | 161/161 verdi, coverage parziale |
| K Quick wins | 🚧 | 7/10 (mancano bonjour-service, content-visibility) |

**Test suite:** 199/199 verdi (17 file), `npm run typecheck` clean,
`npm run build` Vite 5 verde.

### Hotspot di complessità (file > 700 righe)

| File | Righe | Rischio |
| ---- | ----- | ------- |
| `services/streamInfoService.ts` | 1.313 (post B.2) | Parsing HLS/TS/codec/bitrate |
| `services/i18n.ts` | 1.559 baseline (ridotto via lazy locale) | Stringhe inline |
| `components/VideoPlayerNew.tsx` | 973 (post B.1) | Mix Video.js + native + OSD |
| `services/deviceDiscovery.ts` | 956 | Scansione subnet + SSDP + probe TCP |
| `App.tsx` | 923 | Stato globale, routing manuale, refresh BG |
| `components/ChannelList.tsx` | 834 | Virtualizzazione + ricerca + filtri |
| `services/castService.ts` | 766 | Chromecast + DLNA + AirPlay |
| `components/ProfileSettings.tsx` | 651 | Tab unica con molte sezioni |

---

## 🐞 2. BUG-1: sezione "Films" sempre vuota

> **Priorità: P0 — bloccante per UX VOD.** Aggiunto 2026-05-14.
> Su alcuni profili Xtream la tab **Film** appare vuota mentre Live e Serie
> funzionano. L'AI carousel "🎬 Movies - Top Rated" sulla Home non compare
> e `vodCategories` resta `[]` anche dopo cambio profilo.

### 2.1 Analisi causa radice

L'analisi statica di `services/xtream.ts` + `App.tsx` evidenzia **quattro cause
combinate**, tutte plausibili e da mitigare in parallelo:

1. **Cache "avvelenata" da risultati parziali.** `loginXtream` usa
   `fetchSafe` (riga 72-74) che intercetta gli errori delle singole chiamate
   restituendo `[]`. Subito dopo, **il risultato (anche se parzialmente vuoto)
   viene scritto in cache** (`CacheService.saveApiData(cacheKey, finalResult)`,
   riga 169). Se un solo `fetchSafe` di VOD fallisce (timeout, 503 del
   provider, errore parsing JSON, payload troppo grande), la cache memorizza
   `vod: []` come "stato buono" e da quel momento ogni avvio dell'app rilegge
   il film-set vuoto **senza più richiedere il server**. Sintomo: Films vuoto
   "per sempre", finché l'utente non clicca "Riscarica lista" o cancella la
   cache manualmente.

2. **`get_vod_streams` può rispondere in formati non-array.** Alcuni
   pannelli Xtream rispondono con un oggetto (`{ error: "..." }`,
   `{ "1": [...], "2": [...] }`) o con HTML quando il provider mette il
   pannello in manutenzione. `Array.isArray(streams)` (riga 102) scarta tutto
   e il processamento produce `[]`. Inoltre `res.json()` può lanciare e far
   cadere il `fetchSafe`, cadendo nel caso 1.

3. **Categoria "Other" + filtro post-processing.** Se `vodCategories` torna
   vuoto ma `vodStreams` ha contenuti, il codice li accumula in una categoria
   `Other`. Il filter `c.channels.length > 0` (riga 158) la mantiene, ma se
   anche **gli stream** sono assenti perché `Array.isArray(streams) === false`,
   la categoria `Other` non viene mai creata. La detection del caso "ho
   risposte ma in formato anomalo" non è loggata né diagnosticabile.

4. **Caching ottimistico anche su auth-ok ma con limiti parziali.**
   `loginXtream` rifiuta solo `authData.user_info?.auth === 0`. Su provider
   "trial scaduto / VOD disabilitato" il login passa (`auth=1`) ma le
   chiamate `get_vod_*` restituiscono 401 → `fetchSafe` ritorna `[]` → cache
   avvelenata.

### 2.2 Conseguenze osservate

- Cambio profilo / restart app → Films resta vuota: la cache `content_*`
  TTL non scade abbastanza in fretta.
- "Riscarica lista" funziona (forza `forceRefresh = true`) ma l'utente non sa
  che il problema è la cache.
- Nessun log lato UI: l'utente non capisce se è un bug del client o del
  provider.

### 2.3 Soluzione (5 step, ordine consigliato)

> **Stato: ✅ completato 2026-05-14.** Tutti gli step (1-5) implementati e
> testati. Suite 182/182 verdi. Tocca solo `services/xtream.ts`,
> `components/ChannelList.tsx`, `components/ProfileSettings.tsx`, `App.tsx`,
> `types.ts`, `tests/xtream/loginXtream.test.ts`. Nessun impatto su
> player/casting/Android.

#### Step 1 — Non cacheare risultati parziali / vuoti (P0, 0.3 g) ✅

- [x] In `services/xtream.ts::loginXtream`, dopo la fetch parallela,
  calcolare un `fetchHealth` per ogni macro-blocco:

  ```ts
  const health = {
    live:   Array.isArray(liveStreams)   && liveStreams.length   > 0,
    vod:    Array.isArray(vodStreams)    && vodStreams.length    > 0,
    series: Array.isArray(seriesStreams) && seriesStreams.length > 0,
  };
  ```

- [x] Scrivere in cache **solo** se almeno 2 blocchi su 3 sono sani **e** il
  blocco corrispondente al precedente cache hit non è regredito (es. se il
  cached aveva 800 VOD e ora ne abbiamo 0, non sovrascrivere — fondi i due
  risultati conservando il "best of").
- [x] Quando si decide di non cacheare, loggare a console (`console.warn`)
  con il dettaglio dei blocchi mancanti, e ritornare comunque al chiamante
  l'oggetto in memoria (UX immediata + retry alla prossima apertura).

#### Step 2 — Rilevare risposte non-array e parsing alternativo (P0, 0.4 g) ✅

- [x] Rifattorizzato `fetchSafe` → `fetchCatalog` con risultato strutturato
  `FetchResult<T> = { ok: true; data: T[] } | { ok: false; reason: string }`,
  parsing alternativo per `{ data | streams | result: [...] }` e detect
  `{ error: "..." }` / `{ message: "..." }`.
- [x] `loginXtream` consuma i nuovi risultati e propaga i `reason` lungo
  `XtreamContent.health` (Step 4).

#### Step 3 — Retry mirato sui blocchi falliti (P0, 0.3 g) ✅

- [x] `fetchCatalogWithRetry` esegue un solo retry con backoff 1 s e
  timeout 8 s. Wrappato su `get_live_streams`, `get_vod_streams`,
  `get_series` (i blocchi "pesanti" più soggetti a 503 sotto carico).
- [x] Retry limitato a 1 tentativo per non saturare il provider.

#### Step 4 — Feedback UI esplicito + scorciatoia "Riscarica" (P0, 0.3 g) ✅

- [x] `XtreamContent` esteso con
  `health: { live: XtreamBlockHealth; vod: ...; series: ...; fetchedAt }`
  (vedi `types.ts`). Stati: `ok | empty | error | stale` + `reason` umano.
- [x] In `App.tsx` lo stato `catalogHealth` viene propagato a
  `ChannelList` (banner soft cross-tab + `EmptyState` health-aware nel tab
  in errore con CTA "Riscarica lista" e "Apri impostazioni server").
- [x] In `ProfileSettings → Catalogo contenuti`, aggiunto riquadro
  "Ultimo stato Live / Film / Serie TV" con dot colorato (state-success /
  state-warning / state-error) e reason umanamente leggibile.

#### Step 5 — Test unitari (P1, 0.4 g) ✅

- [x] `tests/xtream/loginXtream.test.ts` (15 test): scenari fetchCatalog
  (array puro, wrap `{data|streams|result}`, `{error:…}`, HTML non JSON,
  HTTP 500), fetchCatalogWithRetry (1 retry + backoff), e flussi
  `loginXtream` per:
  - tutte le risposte sane → cache scritta, health all `ok`.
  - 1/3 blocchi sani → cache **non** scritta (poisoning prevention).
  - cache pre-esistente con 200 VOD + fresh 0 VOD → preservata in `stale`.
  - cache pre-esistente + provider error → preservata in `stale`.
  - legacy cache (no `health`) → forza refresh dal server.
  - `empty` con reason esplicativa.
  - `error` con messaggio del provider esposto.

### 2.4 Criteri di accettazione

- [x] `loginXtream` non scrive mai in cache un `vod: []` se la fetch è
  fallita; lo riconosce dal `health` strutturato.
- [x] Una cache con `vod: []` precedente al fix **non blocca** il prossimo
  refresh: lo step 1 fa scattare un re-fetch in background al boot quando
  `health.vod !== 'ok'`.
- [x] L'utente vede in UI il motivo del catalogo vuoto e ha un bottone per
  riprovare senza entrare in ProfileSettings.
- [x] Test 5+1 verdi (15/15 nel file `tests/xtream/loginXtream.test.ts`).
- [ ] Smoke manuale: stessa cache di un profilo "Films vuoto" → dopo
  l'aggiornamento, al prossimo avvio Films popolato senza intervento utente.

### 2.5 Workaround immediato (in attesa del fix)

In `ProfileSettings → Sincronizzazione catalogo` premere **"Riscarica lista"**.
Forza `loginXtream(creds, true)` che bypassa la cache e ripopola Films. Se
persiste, è davvero un problema del provider (`auth=1` ma VOD disabilitato).

---

## 🚨 3. URG-1: Seek VOD bloccante

> **Priorità: P0 — bloccante UX VOD.** Segnalato 2026-05-13.
> Cliccando o trascinando la progress bar di un film/serie il player resta
> congelato per molti secondi (a volte > 1 min) finché non termina il
> download fino alla posizione richiesta. Live non impattato (nessuna
> timeline). Su Android (ExoPlayer) il problema non si presenta.

### 3.1 Cause radice (riepilogo)

1. **Seek-storm da `<input type="range">` invisibile** sovrapposto alla
   timeline: il drag emette `change` a ogni pixel → fino a 200 seek HTTP per
   un singolo drag (confermato in `components/VideoPlayerNew.tsx` ~r.944).
2. **`preload: 'metadata'` + MP4 con `moov` in coda** (manca
   `qt-faststart` lato server): seek richiede di scaricare la coda prima di
   poter mappare timestamp → byte.
3. **Detection engine senza HEAD probe**: nessuna verifica reale di
   `Accept-Ranges` né di `Content-Type`. Provider che rispondono 200 invece
   di 206 o `Accept-Ranges: none` forzano lo scarico completo.

### 3.2 Soluzione (4 livelli, ROI decrescente)

#### Livello 1 — Fix seek-storm (½ giorno, P0) ✅

- [x] Rimosso `<input type="range">` invisibile dalla timeline.
- [x] Scrubbing custom in `useInteractiveTimeline`:
  - `pointerdown` arma + `setPointerCapture`;
  - `pointermove` aggiorna solo lo stato locale (`scrubTime`, UI ottimistica);
  - `pointerup` chiama `onSeek(finalTime)` **una sola volta**;
  - `pointercancel` non emette seek.
- [x] `VideoPlayerNew` espone `performSeek(time)` che usa
  `videoEl.fastSeek?.()`.
- [x] Display-time = `isScrubbing ? scrubTime : currentTime`.
- [x] Accessibilità: `role="slider"`, `aria-valuemin/max/now/text`,
  tastiera (`←/→` ±5s, `PageUp/Down` ±30s, `Home/End`).
- [x] Test `tests/player/scrubbing.test.tsx` (5).

#### Livello 2 — Faststart sintetico per MP4 `moov` in coda (1 g, P0) ✅

- [x] `services/streamInfo/vodProbe.ts` con `probeVodSource(url, …)`:
  HEAD (timeout 4 s) → `Accept-Ranges`, `Content-Type`, `Content-Length`;
  fallback tiny GET `Range: bytes=0-1023`.
- [x] Se Range supportato + length > 2 MB, GET `Range: bytes=<L-2MB>-` per
  scaricare la coda → il `moov` arriva nella HTTP cache locale.
- [x] Memoization in-memory + coalescing chiamate concorrenti.
- [x] `useWebPlayerEngine` per VOD progressivi: `preload: 'auto'` invece di
  `'metadata'`, probe in parallelo fire-and-forget.
- [x] Test `tests/streamInfo/vodProbe.test.ts` (6).

#### Livello 3 — Probe `Accept-Ranges` + content-type sniffing (1 g, P1) ✅

- [x] Risultato del probe propagato al componente via `onVodProbeResult`.
- [x] Quando `rangeSupport === 'no'`: timeline disabilitata (`aria-disabled`),
  niente pointer/focus, banner inline ambra, shortcut ←/→ ignorati, skip
  ±10s disabilitati.
- [x] OSD differenziato per Content-Type:
  - `Accept-Ranges: none` → "Server senza Range: seek non disponibile".
  - `video/x-matroska` → "MKV non supportato dal player web — prova HLS".
  - `video/mp2t` su VOD → "MPEG-TS senza indici: seek può essere lento".
- [ ] Re-mount automatico engine alternativo (es. MIME `video/mp2t` → forza
  `mpegts.js`): pianificato, non bloccante.

#### Livello 4 — Range proxy in Electron Main (2-3 g, P2, opzionale) ⏳

- [ ] Proxy interno `loopback:port/proxy?u=<url>` in `main.js` per server
  che rispondono 200 invece di 206.
- [ ] Fake-Range: scarico chunk richiesto in streaming, scartando byte prima
  dell'offset. Dietro feature flag `experimental.rangeProxy`.
- [ ] Solo Electron (su Android vale ExoPlayer nativo).

### 3.3 Test e verifica

- [x] Suite `npm run test:run` 161/161 verdi.
- [ ] Smoke su 3 provider Xtream reali (mp4 faststart, mp4 non-faststart,
  MKV). Target: tempo da click a `seeked` < 1.5 s sul 95° percentile.

---

## 🎨 4. UI-1: Design System v1

> **Priorità: P1 — usabilità percepita.** Aggiunto 2026-05-13, **completato
> 2026-05-14**. Token CSS + utility Tailwind come sorgente di verità, con
> componenti shared riutilizzabili.

### 4.1 Token e regole d'uso (obbligatorie)

- **Sorgente di verità:** token CSS in `index.css` (`--surface-*`,
  `--brand-*`, `--state-*`, `--text-*`) esposti come utility Tailwind via
  `tailwind.config.js`.
- **Brand:** rosso (`bg-brand-primary`) per CTA primarie (Play, Resume,
  Connect, Save, Create). Viola (`bg-brand-accent`) **solo** per feature
  AI/smart (decisione UI-1.3.6 opzione A, 2026-05-13).
- **Border-radius:** 3 token + circolare:
  - `rounded-control` (12 px) → button, input, chip
  - `rounded-card` (16 px) → card poster, panel info
  - `rounded-modal` (24 px) → dialog, sheet
  - `rounded-full` solo per badge/avatar circolari.
- **Surface tier:** `surface-0` (body), `surface-1` (panel secondari),
  `surface-2` (panel primari / input), `surface-3` (hover / selected),
  `surface-overlay-soft/hard` per modali.
- **Stato:** un solo tono per ruolo — `text-state-error|warning|success|info`.
  Vietato mischiare `red-300/400/500` nello stesso file.
- **Icone:** scala fissa `w-icon-xs|sm|md|lg|xl` (12/16/20/24/32 px).
- **Componenti shared (`components/shared/`):** `Button`, `IconButton`,
  `Input`, `FormField`, `Select`, `Chip`, `Badge`, `Card`, `Modal`, `Sheet`,
  `Spinner`, `Icon`, `EmptyState`, `LoadingState`, `ErrorState`,
  `WatchlistButton`.

### 4.2 Migrazione ✅ completata

Tutti i componenti chiave migrati a DS v1:

- [x] MovieDetail, SeriesDetail
- [x] XtreamLogin (`useActionState` React 19)
- [x] ProfileSettings (toggle, divider, section card)
- [x] ProfileSelection
- [x] CommandPalette
- [x] AIRecommender (`brand-accent` come AI semantic color)
- [x] ChannelList (search, progress, logout)
- [x] GuideView ("ORA" button, banner errore EPG)
- [x] VideoPlayerNew (overlay errore, timeline, control bar)
- [x] MiniEpgOverlay, AutoNextOverlay, SleepTimerMenu
- [x] Quick-win: ShortcutsCheatsheet, CodecWarning, CastDevicePicker,
  XtreamHealthBadge.

### 4.3 Accessibilità ✅ completata 2026-05-14

- [x] `aria-label` obbligatorio su `IconButton` (prop type + warning runtime).
- [x] Contrasto WCAG AA verificato (test contract calcola
  `relativeLuminance`/`contrastRatio`); `--text-disabled` bumpato a `#94a3b8`.
- [x] `prefers-reduced-motion: reduce` disabilita `scale-105` di `tv-focus`
  e tutte le animazioni applicative (`@media` esteso in `index.css`).
- [x] Focus ring **outside** elemento: `.tv-focus` e `.tv-focus-dense` usano
  `outline + outline-offset` invece di `ring-4` (no overflow in liste dense).

### 4.4 Smoke test visivo & test contract

- [x] Galleria `components/DesignSystemPreview.tsx`, accessibile via
  `?ds-preview` in URL o `window.__SHOW_DS_PREVIEW = true`.
- [x] `tests/ui/tokens.test.ts` (53 test).
- [x] `tests/ui/shared.test.tsx` (19 test).
- [x] **Occorrenze `(bg|text|border)-(red|purple)-\d{3}` in `components/`:
  70+ baseline → 0 attuali** ✅

### 4.5 Criteri di accettazione

- [x] Un solo colore brand (rosso) per CTA primarie applicative.
- [x] Tre soli border-radius (`control / card / modal`) + `rounded-full`.
- [x] Quattro soli livelli di surface (0/1/2/3) + 2 overlay.
- [x] Zero hex / RGBA hard-coded nei `.tsx` migrati.
- [x] Quattro stati semantici (error/warning/success/info), un tono ciascuno.

---

## 5. Roadmap prioritaria P0-P8

### P0 — Sicurezza e stabilità immediata

#### P0.1 Triage vulnerabilità `npm audit`

- [ ] `npm audit` completo + `npm audit --omit=dev`.
- [ ] Classificare per severità: runtime / dev-only / transitive / non sfruttabili.
- [ ] Aggiornare dipendenze dirette non breaking.
- [ ] `overrides` solo per transitive non aggiornabili.
- [ ] Evitare `npm audit fix --force` salvo tranche dedicata + test completi.
- [ ] CVE pacchetti networking: `bonjour`, `node-ssdp`, `ws`, `castv2-client`.
- [ ] Documentare vulnerabilità residue accettate.

#### P0.2 Hardening WebSocket remote control

- [ ] Mappare tutte le azioni remote supportate + schema payload ammesso.
- [ ] Token locale generato all'avvio + pairing PIN/QR.
- [ ] Rate limit per client/IP, chiusura connessioni malformate.
- [ ] Niente log di URL stream completi/credenziali.

#### P0.3 Validazione IPC Electron

- [ ] Elencare tutte le API di `preload.js` + verificare handler `ipcMain`.
- [ ] Validare input per IP, porte, URL stream, payload cast.
- [ ] Normalizzare errori IPC in risposte strutturate.
- [ ] Mantenere `contextIsolation: true`, `nodeIntegration: false`.

#### Già completato in P0 (sicurezza baseline)

- [x] Rimosse chiavi API hardcoded.
- [x] `.env.example` per `VITE_GEMINI_API_KEY` e `VITE_TMDB_API_KEY`.
- [x] `.gitignore` per `.env`, keystore, APK/AAB, asset Android generati.
- [x] Rimosso `android/streamai-release.keystore` dal versionamento.
- [x] Hardening Electron dietro `STREAMAI_INSECURE_ELECTRON`.
- [x] Hardening Android debug WebView dietro `STREAMAI_ANDROID_DEBUG`.
- [x] Script release Android senza password hardcoded.
- [x] Fix runtime Electron: `bonjour`, `node-ssdp`, `ws` risolvibili.
- [x] Socket UDP broadcast corretto in `main.js` (no `EBADF`).

### P1 — Performance bundle e avvio

#### P1.1 Riduzione chunk Vite ✅ target raggiunto (vedi E.1)

- [x] Code splitting via `React.lazy` + `Suspense` in `App.tsx`.
- [x] Chunk dedicati: VideoPlayerNew, ProfileSettings, GuideView,
  MovieDetail, SeriesDetail, AIRecommender, XtreamLogin.
- [x] **Chunk iniziale 580 → ~146 kB gzip (−75%)**.
- [ ] Pre-render Home come HTML statico in `dist/index.html` per TTFP
  Electron < 250 ms.
- [ ] `import.meta.glob` lazy per categorie metadata ed engine player.
- [ ] Verifica trade-off `lucide-react` import puntuale.

#### P1.2 Lazy loading schermate pesanti ✅

- [x] React.lazy + fallback dark-theme per le schermate pesanti.
- [x] Shortcut, focus, back navigation preservati.

### P2 — Player Desktop/Android

#### P2.1 Error handling stream più diagnostico ✅

- [x] Distinguere HTTP 401/403, 404, timeout, codec, manifest HLS fatali.
- [x] Pulsante "Riprova" + sezione "Dettagli tecnici" con URL sanitizzato.
- [x] Retry esponenziale leggero con limite massimo.
- [x] OSD per retry/errori.

#### P2.2 PiP Android e player nativo ✅ codice

- [x] `MainActivity` configura `PictureInPictureParams`, `autoEnterEnabled`,
  ingresso PiP sicuro da `onUserLeaveHint`.
- [x] Capability flag `supportsPiP`, salvataggio/ripristino progresso da
  ExoPlayer + polling fallback, retry/error handling nativo con OSD.
- [ ] **Verifica manuale Android (release gate):** device fisico/emulatore
  API 26+, JDK 17 completo, build APK, Home/PiP/return-to-app, audio
  background, codec HEVC.

> **Nota verifica 2026-05-12:** ambiente locale ha solo Java 25 runtime
> (manca `javac`). Build Android richiede JDK 17 completo. Vite build +
> `npx cap sync android` OK; Gradle si ferma con "Unsupported class file
> major version 69". Verifica fisica = gate di rilascio.

#### P2.3 Fallback player e codec ✅

- [x] Detection protocolli: m3u8, ts, mp4, webm, dash, Xtream extensionless.
- [x] Fallback HLS.js / Video.js / mpegts.
- [x] Messaggio specifico HEVC/H.265 non supportato.
- [x] Popup info stream con codec HLS / MPEG-TS PAT/PMT.

### P3 — Casting, discovery e rete locale

#### P3.1 Discovery cancellabile ✅

- [x] `AbortController`, concorrenza limitata, timeout configurabili,
  deduplica per IP/protocollo/nome, TTL cache, progress UI.
- [x] Probe TCP/HTTP nativi Electron preferiti a `WebSocket.onerror`.

#### P3.2 Casting più robusto ✅ codice

- [x] Stato esplicito: connecting/connected/buffering/error/disconnected.
- [x] Retry controllato cast load + timeout connect/load/control.
- [x] Messaggi differenziati per device offline / protocollo / stream rifiutato.
- [x] Handler IPC Electron per discovery / connect / load / control / disconnect.
- [ ] **Da verificare:** test manuali su Chromecast/DLNA reali.

#### P3.3 Advertising service production-safe ✅

- [x] Errori mDNS/SSDP non fatali, retry/fallback porta HTTP DIAL.
- [x] Shutdown pulito su `will-quit`.
- [x] Smoke `timeout 20s npm run start` OK.

### P4 — UX TV, telecomando e Android

#### P4.1 Focus management TV ✅ codice

- [x] Focus iniziale per ogni schermata, focus trap modali, ripristino
  dopo chiusura, navigazione spaziale container-safe.
- [ ] **Da verificare:** test telecomando/TV box reale.

#### P4.2 Stati vuoti, loading, errori ✅

- [x] Tutti gli stati shared coperti (no canali / server / credenziali /
  TMDB / Gemini / cast / skeleton / retry visibile).

#### P4.3 Ottimizzazioni Android/TV box ✅ codice

- [x] Controlli touch grandi, safe area/notch, overlay minimali su native,
  classi `platform-native`/`tv-low-power` per blur disabilitati.
- [ ] **Da verificare:** matrice device reali (modello, API, telecomando).

### P5 — AI, metadata e catalogo

#### P5.1 Gemini più contestuale ✅

- [x] Prompt diversi per Live / Movies / Series, lingua profilo, cronologia,
  generi stimati, dedup recent, ranking locale pre-chiamata.
- [x] Stati "AI non configurata" / "AI sospesa".

#### P5.2 Cache AI e TMDB ✅

- [x] TTL Gemini, invalidation per profilo/lingua, limite dimensione,
  pulsante svuota cache, Cache TMDB con TTL, dedupe, fallback lingua.

#### P5.3 Matching metadata accurato ✅

- [x] Pulizia titoli IPTV, anno nel match, fuzzy leggero, multi-lingua,
  evita falsi positivi su titoli corti, test unitari.

#### P5.4 Sincronizzazione catalogo Xtream ✅

- [x] Pulsante "Riscarica lista" in ProfileSettings (bypassa cache).
- [x] Refresh automatico configurabile (1h/3h/6h/12h/24h) + lock + offline guard.
- [x] Timestamp ultimo refresh + ultimo errore salvati nel profilo.
- [x] README aggiornato.

### P6 — Performance catalogo e immagini

#### P6.1 Ricerca indicizzata ✅

- [x] `catalogIndex` con `cleanNameLower`, `groupLower`, `genreLower`, `year`.
- [x] Debounce + `useDeferredValue`. Worker rinviato (test 8k sotto soglia).

#### P6.2 Virtualizzazione avanzata ✅

- [x] Virtualizzazione righe orizzontali con overscan, paginazione
  "Mostra altri", lazy image IntersectionObserver, skeleton poster.

#### P6.3 Cache immagini con policy ✅

- [x] Limite 1500 / 512 MB, TTL 30 giorni, cleanup automatico + aggressivo
  oltre soglia, statistiche in Settings, pulsante svuota.
- [x] Cache API (`streamai-images-v1`) + IDB legacy fallback (E.5).

### P7 — Qualità tecnica e test

#### P7.1 Test automatici 🚧

- [x] `vitest` + `jsdom` installati. Script `test`, `test:run`, `check`.
- [x] Test moduli puri: `codecParser` (13), `hlsParser` (5), `mpegtsProbe`
  (13), `playerUtils` (15), `scrubbing.test.tsx` (5), `vodProbe` (6),
  `xmltvParser` (11), `reminderService` (5), `subtitleService` (11),
  `gzipUtil` (5), `useBackStack` (6), `ui/tokens` (53), `ui/shared` (19),
  `xtream/loginXtream` (15, BUG-1 §2.3 Step 5), `workers/workers` (7, E.3),
  `catalog/catalogIndex` (6, C.3 filtri avanzati).
- [x] **Totale: 195/195 verdi (16 file).**
- [ ] `@testing-library/react` snapshot UI critici (`ChannelList`, `ProfileSelection`).
- [ ] Test parser M3U, ProfileService, CacheService, i18n shape, Xtream URL helper.
- [ ] Mock test discovery/cast service.
- [ ] **Test BUG-1** `loginXtream` + cache poisoning (vedi §2.3 Step 5). ✅ chiuso.
- [ ] Coverage minimo 50% su `services/`.

#### P7.2 Lint e validazione CI ⏳

- [ ] ESLint 9 flat + React/Hooks/TypeScript + `jsx-a11y`.
- [ ] Prettier + `tailwindcss/prettier-plugin`.
- [ ] Custom check segreti hardcoded.
- [ ] Script `lint`, `validate` (= `typecheck && lint && test:run && build`).
- [ ] Husky + lint-staged.

#### P7.3 Smoke test Electron 🚧

- [x] Smoke `timeout 20s npm run start` OK (no `Uncaught Exception`,
  no `Cannot find module`, advertising e WebSocket start/stop puliti).
- [ ] Script automatizzato in CI.

### P8 — Feature future ad alto valore

- [ ] **P8.1 Companion remote da smartphone** — pagina locale PIN/QR,
  pairing, controlli play/pausa/volume/seek/canale, ricerca, auth obbligatoria.
- [x] **P8.2 Diagnostica stream** — schermata Info Stream con codec,
  risoluzione, bitrate stimato, protocollo, buffer health, errori recenti,
  URL redatto. Implementata in `components/player/StreamDiagnostics.tsx`
  (aside slide-from-right, DS-v1) e cablata in `VideoPlayerNew.tsx`:
  buffer stats vivi (refresh ogni 1s mentre il pannello è aperto), ring
  buffer max 10 errori da `playbackError`, URL sanificato con copia,
  warning per HEVC/HDR/Dolby Vision e frame drop.
- [ ] **P8.3 Backup/import profili** — export/import JSON, cifratura
  opzionale, mascheramento credenziali, migrazione desktop ↔ Android.
- [ ] **P8.4 Parental control / profilo Kids** — PIN profilo, blocco
  categorie, filtro adult, modalità bambini.

---

## 6. Debt tecnico ad alto impatto (B)

### B.1 Refactor `VideoPlayerNew.tsx` ✅ (1542 → 973 righe)

- [x] Estratti: `usePlayerShortcuts`, `usePlayerOsd`, `useInteractiveTimeline`,
  `usePlayerMediaSession`, `useRemoteControl`, `useWebPlayerEngine`,
  `useNativePlayerEngine`, `components/player/{playerTypes, playerUtils}`.
- [x] Comportamento invariato (test 161/161, build OK).

### B.2 Decomposizione `streamInfoService.ts` ✅ (2018 → 1313 righe)

- [x] Cartella `services/streamInfo/`: `types`, `codecMap`, `codecParser`,
  `hlsParser`, `mpegtsProbe`, `videoBytesAnalyzer`, `vodProbe`, `index` facade.
- [x] API pubbliche re-esportate per backward compat.

### B.3 i18n lazy + struttura per chiavi ✅

- [x] File per-lingua in `services/locales/{it,en,es,fr,de,pt,ru,ja,ko,zh,ar}.ts`.
- [x] `loadLanguage()` con cache + coalescing. Solo `it` nel bundle iniziale.
- [x] `scripts/check-i18n.mjs` validatore drift (exit ≠ 0 su differenze).

### B.4 Routing dichiarativo ✅

- [x] `hooks/useBackStack.ts`: stack layer top-down, `onClose`, `skipEsc`,
  `onEmpty` (uscita app Android).
- [x] Rimossi `handleEscape` + `handleBackButton` ad-hoc.
- [x] API `topId` / `openIds` pronte per companion remote (deep-link).
- [x] Test `tests/hooks/useBackStack.test.tsx` (6).

### B.5 Upgrade React 18 → 19 ✅

- [x] `react@19.2.6`, `react-dom@19.2.6`, types aggiornati.
- [x] `RefObject<T | null>` adeguato in `useTvFocus`, `useInteractiveTimeline`.
- [x] `useTransition` su filtro CommandPalette.
- [x] `useActionState` su `XtreamLogin` (form FormData).
- [~] `use()` hook: non applicabile a `useMediaMetadata`/`useMediaImages`
  (pure derivazioni `useMemo`). Riservato a future feature async.

---

## 7. UX gap residui (C)

### C.1 Discoverability scorciatoie 🚧

- [x] Overlay `?` / `Shift+/` cheatsheet completa.
- [x] Tooltip su pulsanti player con scorciatoia (`F`, `M`, `P`, ...).
- [ ] Mostrare cheatsheet al **primo avvio profilo**, poi "Non mostrare più".

### C.2 Onboarding profilo ✅

- [x] **Wizard 3 step (2026-05-15):** identità (nome + colore + avatar) →
  fonte contenuti → preferenze. Componente `components/OnboardingWizard.tsx`
  con step indicator (done/current/todo), navigazione Avanti/Indietro,
  validazione per-step (es. nome obbligatorio in step 1, test KO blocca
  step 2). Sostituisce il vecchio modale inline in `ProfileSelection.tsx`.
- [x] **Test connettività Xtream in tempo reale (2026-05-15):** pulsante
  "Testa connessione" chiama `getXtreamAccountInfo` con timeout dedicato di
  10 s; mostra esito (status abbonamento + data di scadenza) come chip
  inline con icona success/error. Errori di rete/auth restituiscono
  messaggio user-friendly.
- [x] **Import M3U remoto (2026-05-15):** in alternativa a Xtream, l'utente
  può inserire un URL `.m3u`/`.m3u8`. Validazione: `fetch` con
  `Range: bytes=0-4095`, check presenza di `#EXTM3U`, conteggio `#EXTINF`
  per stimare il numero di canali nel preview. Il profilo viene creato con
  `Profile.playlistUrl`; `App.tsx` carica e fa parse via `parseM3UAsync`
  (worker se >256 kB) all'attivazione del profilo, popolando la sezione
  Live. Tests `tests/onboarding/wizard.test.tsx` (4): blocco Avanti senza
  nome, validazione URL, creazione profilo M3U+lingua, profilo "Configura
  dopo" senza fonte.

### C.3 Ricerca globale ✅

- [x] `Cmd/Ctrl+K` palette su Live + Movie + Series.
- [x] Recent searches per profilo (`streamai.cmdk.recent.<id>`).
- [x] Highlight match (`<mark>`), filtri chip Tutto/Live/Film/Serie.
- [x] Tastiera completa (Tab/Shift+Tab, ↑/↓, Home/End, Enter, Esc).
- [x] **Filtri avanzati (2026-05-14):** HD only (regex su tag qualità nel
  nome + group: FHD/UHD/HEVC/H265/4K/2160p/1440p/1080p/720p/HDR/Dolby), Nuovi
  (ultimi 30 giorni via Xtream `added` → `Channel.addedAt`), per genere
  (`<select>` con generi più frequenti del catalogo, top 16 ordinati per
  frequenza). Combinabili tra loro e con la tab type-filter. Bottone
  "Pulisci" e auto-reset del genere selezionato quando non più disponibile
  dopo cambio tab. Tests `tests/catalog/catalogIndex.test.ts` (6).

### C.4 Continua a guardare migliorato ✅

- [x] Carosello dedicato + progress bar visibile sul poster.
- [x] Soglia "completato" configurabile (default 95%, `[0.70, 0.99]`).
- [x] Auto-next episodio con countdown 10s (`useAutoNextEpisode` +
  `AutoNextOverlay`). Riarmo se seek-back > 30s dalla fine.
- [x] **Toggle per-tipo (2026-05-15):** `ProfilePreferences.continueWatchingMoviesEnabled`
  (default `false`) e `continueWatchingSeriesEnabled` (default `true`). Il
  carosello "Continua a guardare" in `ChannelList` filtra per tipo prima
  della tab attiva. Toggle dedicati in `ProfileSettings → Riproduzione`.
- [ ] Sync progress Desktop ↔ Android (D.6 BYOC).

### C.5 Gesture touch Android ⏳

- [ ] Swipe verticale sinistra = luminosità, destra = volume (overlay OSD).
- [ ] Doppio tap left/right = -10s / +10s con ripple.
- [ ] Pinch fullscreen ↔ aspect ratio toggle.

### C.6 Accessibilità ⏳ (parte fatta in UI-1.4)

- [x] `aria-label` su `IconButton` (DS).
- [x] Focus ring contrastato outside (UI-1.4).
- [x] `prefers-reduced-motion` rispettato (UI-1.4).
- [ ] Modalità daltonici (badge HD/Live/Premium con icona oltre al colore).
- [ ] Font size selezionabile (S/M/L/XL) in ProfileSettings.
- [ ] Audit completo `aria-label` su pulsanti icon-only non DS.

### C.7 Lingua per profilo, davvero ⏳

- [ ] Cambio lingua a caldo senza reload (B.3 ha già il lazy load).
- [ ] Locale data/ora con `Intl.DateTimeFormat`.

### C.8 UX papercuts (2026-05-15) ✅

- [x] **AI hint dismissibile.** Il banner "AI non configurata" mostrato in
  `App.tsx` (`AiUnavailableHint`) ora ha: auto-dismiss 8 s, pulsante `X`,
  checkbox "Non mostrare più" che setta `ProfilePreferences.hideAiUnavailableHint`.
  Stato in-memory `aiHintSessionDismissed` per silenziarlo nella sessione
  senza toccare il profilo; reset al cambio profilo. Componenti DS-v1
  (`Card`, `IconButton`, `text-state-warning`).
- [x] **Ordine gruppi Live preservato.** `services/xtream.ts` →
  `processContent()` ora mantiene l'ordine d'inserimento delle categorie
  per `type === 'live'` (così come restituite dal server Xtream),
  conservando l'ordinamento alfabetico solo per `movie`/`series`. Risolve
  la sensazione di "categorie mescolate" segnalata dagli utenti.
- [x] **Toggle Continua a guardare per-tipo.** Vedi C.4.

---

## 8. Nuove feature ad alto valore (D)

### D.1 EPG ✅ Fasi 1-3

- [x] Servizio `services/epg/` con parser XMLTV streaming (no DOMParser su
  file > 10 MB), indice `Map<tvgId, EpgProgramme[]>`, purge automatica,
  cache 6h + fallback stale.
- [x] Mini-EPG nel player (overlay `G` su Live): programma corrente +
  prossimi 3, refresh 60s.
- [x] Vista Guide TV completa (`components/GuideView.tsx`): grid
  virtualizzata, timeline sticky, salto a "now", navigazione giorno.
- [x] Promemoria con notifica nativa + toast in-app, scheduler 30s, fire 2
  min prima. Test (`xmltvParser` 11, `reminderService` 5).
- [ ] Pianificazione registrazione dal menu programma (richiede D.3).

### D.2 Timeshift / Catch-up TV ⏳

- [ ] Detect `user_info.allowed_output_formats`.
- [ ] `←/→` su Live retrocedono fino a N ore se supportato.
- [ ] Indicatore "Live edge" + jump-to-live (`Home`).
- [ ] Buffer locale ring (30 min) per micro-rewind.

### D.3 Registrazione stream (Desktop) ⏳

- [ ] Tasto `R` su Live/VOD: dump segmento via Node `https.get` → `.ts`/`.mp4`.
- [ ] Job manager + pianificazione da EPG.
- [ ] Cartella configurabile + capability flag (solo Electron).

### D.4 Multi-audio e sottotitoli 🚧 sub MVP

- [ ] Esporre `AudioTrackList` Video.js (`A` per menu lingua).
- [x] **Sottotitoli MVP (2026-05-13):** sideload SRT/VTT, parser SRT→VTT
  tollerante, `<track>` injection, menu shortcut `S`, reset al cambio
  canale, revoke Blob URL all'unmount. Test `subtitleService` (11).
- [ ] WebVTT da HLS embed (`Hls.Events.SUBTITLE_TRACKS_UPDATED`).
- [ ] OpenSubtitles API key opzionale.
- [ ] Stile personalizzabile + persistenza per profilo/episodio.

### D.5 Audio-only + Sleep timer + Alarm 🚧 sleep ok

- [ ] Modalità "Solo audio" (radio IPTV / podcast).
- [x] **Sleep timer (2026-05-13):** preset 15/30/60/90 min + fine programma
  EPG, fade-out audio (default 5 s), shortcut `T`, badge animato.
- [ ] Sveglia (avvia canale X a ora Y, Electron + `node-schedule`).

### D.6 Sync cloud opzionale (BYOC) ⏳

- [ ] Provider plug-in: WebDAV / Nextcloud / Dropbox / iCloud Drive.
- [ ] Sync profili (no credenziali), history, watchlist, EPG reminders.
- [ ] Cifratura AES-GCM con passphrase utente (zero-knowledge).
- [ ] Risoluzione conflitti per timestamp.

### D.7 Watchlist potenziata ⏳

- [ ] Cartelle/tag custom ("Stasera", "Per i bambini").
- [ ] Smart-list AI ("Cosa vedere se ho 45 min").
- [ ] Watchlist condivisibile tra profili dello stesso device (opt-in).

### D.8 Parental control rafforzato ⏳ (estende P8.4)

- [ ] PIN 4-6 cifre con throttling tentativi.
- [ ] Blocco per **rating** (G/PG/PG-13/R/NC-17).
- [ ] Whitelist canali kid-friendly.
- [ ] Limite orario di visione (es. no stream 21:00-07:00 per Kids).
- [ ] Report settimanale di visione locale (privacy first).

### D.9 Statistiche di visione ⏳

- [ ] Dashboard locale: ore/settimana, top generi, top canali, heatmap.
- [ ] Export CSV.

### D.10 Tema OLED + temi custom 🚧 OLED ok

- [x] OLED true black (`.theme-oled` in `index.css`, switcher in Settings).
- [ ] Tema chiaro per uso diurno desktop.
- [ ] Tema auto per orario.
- [ ] Color accent custom (picker hex).

### D.11 Integrazioni esterne opzionali ⏳

- [ ] Trakt.tv scrobbling (OAuth).
- [ ] Discord Rich Presence (Electron only).
- [ ] Last.fm scrobbling per radio.
- [ ] MQTT publish stato player → home automation.

### D.12 Modalità multistream (PiP avanzato desktop) ⏳

- [ ] Mosaic 2×2 / 1+3 (multi-sport).
- [ ] Click su tile = primo piano + audio.
- [ ] Feature flag, Electron only (richiede ~4× banda).

---

## 9. Performance avanzata (E)

### E.1 Bundle e cold start ✅ target raggiunto

- [x] Code splitting via `React.lazy` (vedi P1.1).
- [x] Bundle iniziale 146 kB gzip < target 250 kB.
- [ ] Pre-render Home statica per TTFP Electron < 250 ms.
- [ ] `import.meta.glob` lazy per metadata categories ed engine player.

### E.2 Rendering React 🚧

- [ ] Audit `React.memo` mancanti (ChannelList row, card poster Home).
- [x] `useDeferredValue` su input ricerca canali.
- [x] `structuredClone` al posto di `JSON.parse(JSON.stringify(...))` —
  **N/A**: nessuna occorrenza trovata nel codebase.
- [ ] `ProfileService` con `useSyncExternalStore` per evitare re-render globali.

### E.3 Web Worker pipeline ✅ 2026-05-14

- [x] `services/workers/playlistWorker.ts` per parse M3U > 256 kB.
- [x] `services/workers/epgWorker.ts` per parse XMLTV + prune (streaming-style,
  scarica blocchi `<programme>` via regex, niente DOMParser).
- [x] `services/workers/metadataWorker.ts` per fuzzy matching TMDB in batch
  (`pickBestMetadataCandidate` su N candidati per item).
- [x] Facciata `services/workers/index.ts`:
  - Pool 1 worker per tipo con `id` incrementale e Promise-per-richiesta.
  - Soglie size-based (256 kB M3U/XMLTV, batch ≥ 4 per metadata) per evitare
    l'overhead di spawning su payload piccoli.
  - Auto-terminate dopo 60s di idle (libera RAM).
  - Fallback **sincrono main-thread** quando `Worker` non è disponibile
    (Node/Vitest) o quando il worker fallisce. Risultato identico.
- [x] `services/epg/index.ts` migrato a `parseXmltvAsync`: parse + prune
  vengono offloadati al worker su file XMLTV grandi; main thread costruisce
  solo l'indice `Map<tvgId, EpgProgramme[]>` (O(n) leggero).
- [x] Vite emette i 3 worker come chunk separati (`playlistWorker-*.js`,
  `epgWorker-*.js`, `metadataWorker-*.js`) via
  `new Worker(new URL('./xxxWorker.ts', import.meta.url), { type: 'module' })`.
- [x] Test `tests/workers/workers.test.ts` (7 test): env detection + smoke
  M3U/XMLTV/metadata in modalità fallback.

### E.4 Networking ⏳

- [ ] Request coalescing in `xtream.ts` (BUG-1 ha già coalescing parziale per probe).
- [ ] Backoff esponenziale unificato (jitter) per Xtream/TMDB/Gemini.
- [ ] HTTP keep-alive in Electron main (`https.Agent({ keepAlive: true })`).
- [ ] Prefetch poster appena un canale entra in viewport.

### E.5 Cache e storage ✅

- [x] `cacheService` su IndexedDB (LRU, TTL, quota tracking).
- [x] **Image cache via Cache API** (`services/imageCacheApi.ts`, 2026-05-13):
  Cache API → IDB legacy → null. TTL 30g, LRU header-based, cleanup aggressivo.
- [x] **Compressione cache TMDB con `CompressionStream('gzip')`**
  (`services/gzipUtil.ts`, 2026-05-13). Trasparente, compatibile con record
  legacy. Test `gzipUtil` (5).
- [ ] Service worker (Vite PWA) per asset statici → avvio offline web.

### E.6 GPU / smoothness ⏳

- [ ] `transform: translateZ(0)` controllato (no abuse will-change).
- [ ] Animazioni con `@property` CSS.
- [ ] `content-visibility: auto` su sezioni catalogo non visibili.

### E.7 Player ⏳

- [ ] Riuso istanza Video.js tra canali (oggi viene ricreata) → meno GC.
- [ ] Pre-buffer canale successivo (1-2 segmenti HLS) opzionale.
- [ ] `hls.js` `maxBufferLength` adattivo in base a banda misurata.

### E.8 Android specifico ⏳

- [ ] `android:hardwareAccelerated` + `largeHeap` per ExoPlayer 4K.
- [ ] R8 full mode + proguard rules rivisti.
- [ ] SplashScreen Capacitor 7 < 600 ms.

---

## 10. Affidabilità e osservabilità (F)

### F.1 Telemetria locale opt-in ⏳

- [ ] Ring buffer eventi (mem only) consultabile da Settings → Diagnostica.
- [ ] Export `diagnostics-bundle.json` sanitizzato.
- [ ] Mai uscire dalla LAN senza consenso esplicito.

### F.2 Crash reporting Electron ⏳

- [ ] `electron.crashReporter` con dump locale (no upload).
- [ ] Pulsante "Apri cartella crash" in About.

### F.3 Health-check Xtream ✅

- [x] Job background 30 min: `player_api.php?action=get_account_info`.
- [x] Badge profilo: scadenza, banda, connessioni attive.
- [x] Alert 7 giorni prima della scadenza.
- Implementato in `services/xtream.ts::getXtreamAccountInfo`,
  `hooks/useXtreamHealthCheck.ts`, `components/XtreamHealthBadge.tsx`.

### F.4 Test su rete reale ⏳

- [ ] Suite Playwright (Electron headless) per smoke UI.
- [ ] Mock server Xtream locale (`scripts/mock-xtream.mjs`) per CI.

---

## 11. Qualità del codice e DX (G)

### G.1 Test automatici 🚧 (vedi P7.1)

161/161 verdi. Mancano UI snapshot, parser M3U, ProfileService, CacheService,
i18n shape, discovery/cast mock, **test BUG-1** (loginXtream + poisoning).

### G.2 ESLint + Prettier + Husky ⏳

- [ ] ESLint 9 flat + React/Hooks/TypeScript + `jsx-a11y`.
- [ ] Prettier con `tailwindcss/prettier-plugin`.
- [ ] Husky + lint-staged → blocca push con errori.

### G.3 Allineamento documentale 🚧

- [x] `copilot-instructions.md` e `AGENTS.md` aggiornati a React 19.
- [ ] Allineare AGENTS.md con i nuovi moduli `services/streamInfo/`.
- [ ] Generare API doc dei service singleton con TypeDoc.

### G.4 CI GitHub Actions ⏳

- [ ] `ci.yml`: typecheck + lint + test + build Vite + smoke Electron 10s.
- [ ] `android.yml`: build APK debug su PR (artefatto).
- [ ] Release: tag → build Linux tar.gz + Android APK firmato (secret-based).

### G.5 Dependency hygiene ⏳

- [ ] `bonjour` → `bonjour-service` (TS, manutenuto).
- [ ] `node-ssdp` → fork attivo (`@achingbrain/ssdp` o `@homebridge/ssdp`).
- [ ] `castv2-client` → valutare `chromecast-api` o `tls.connect` custom.
- [ ] Audit periodico (P0.1).

---

## 12. Quick wins (K)

Lista isolata per PR rapidi (≤ 1 giorno).

- [x] `Shift+/` cheatsheet (C.1 overlay).
- [x] Tema OLED (D.10).
- [x] `useDeferredValue` su ricerca canali (E.2).
- [x] `structuredClone` — N/A (nessuna occorrenza).
- [x] `aria-label` su bottoni icon-only del player (16 controlli).
- [x] Tooltip player con scorciatoia (M/F/P/C/L/←/→/Spazio/Esc).
- [x] Health-check Xtream con badge scadenza (F.3).
- [x] Allineare copilot-instructions a React reale (G.3).
- [ ] Sostituire `bonjour` → `bonjour-service` (G.5).
- [ ] `content-visibility: auto` sui carousel non visibili (E.6).
- [x] **BUG-1 quick patch (1h):** ✅ già coperto dal fix completo §2.3
  (invalidazione cache su blocchi non sani + EmptyState health-aware).

---

## 13. Roadmap consigliata (12 settimane)

### Sprint 0 (urgente, ~2-3 giorni) — BUG-1 Films + URG-1 residuo

- [x] **BUG-1 §2.3 Step 1-5** (~1.7 g): cache hardening, retry mirato,
  feedback UI, test unitari. ✅ 2026-05-14 (15/15 test).
- [x] URG-1 Livello 1-3 (✅ 2026-05-13).
- [ ] URG-1 Livello 4 opzionale (Range proxy Electron).
- [ ] Smoke su 3 provider reali (mp4 faststart, non-faststart, MKV).

### Sprint 0.5 — UI-1 DS v1 ✅ completato 2026-05-14

### Settimane 1-2 — Foundation refactor

- B.1 split `VideoPlayerNew` ✅, B.2 split `streamInfoService` ✅.
- G.1 vitest base ✅ — espandere coverage `services/`.

### Settimane 3-4 — UX win rapidi

- C.1 cheatsheet al primo avvio.
- C.2 onboarding wizard.
- C.3 Cmd+K palette ✅, C.4 continua a guardare ✅.
- D.10 theme switcher esteso (light, auto, accent custom).

### Settimane 5-6 — EPG + Timeshift

- D.1 EPG ✅, D.2 Timeshift base.
- E.3 worker per XMLTV ✅.

### Settimane 7-8 — Multi-audio/sub + Registrazione

- D.4 audio tracks + WebVTT HLS + OpenSubtitles.
- D.3 recording Electron + scheduling da EPG.
- C.5 gesture Android.

### Settimane 9-10 — Performance e bundle

- E.1 manualChunks tuning, E.2 audit memo, E.5 SW PWA.
- E.7 riuso Video.js, E.8 Android specifico.

### Settimane 11-12 — Reliability + integrazioni

- F.1/F.2 diagnostica + crash reporter.
- F.3 health-check ✅. D.8 parental control esteso.
- D.11 una integrazione esterna (Trakt o Discord RPC).
- G.4 CI GitHub Actions completa.

---

## 14. Metriche di successo

| Metrica | Baseline | Target | Stato |
| ------- | -------- | ------ | ----- |
| Chunk JS iniziale gzip | 580 kB | < 250 kB | ✅ 146 kB |
| Time-To-First-Paint Electron | n/a | < 800 ms | ⏳ misura |
| Time-To-Interactive con 10k canali | n/a | < 2 s | ⏳ misura |
| Memoria a regime (Electron, 1 live) | n/a | < 350 MB | ⏳ misura |
| FPS scroll catalogo (ChannelList) | n/a | ≥ 55 | ⏳ misura |
| Tempo cold start APK Android | n/a | < 2.5 s | ⏳ misura |
| Copertura test `services/` | 0% | ≥ 50% | 🚧 parziale |
| Errori non gestiti per sessione (1h) | n/a | 0 | ⏳ misura |
| Accessibility score (Lighthouse web) | n/a | ≥ 90 | ⏳ misura |
| **Films section popolata su 5/5 provider testati** | 4/5 | 5/5 | 🚧 fix landato, attesa smoke su provider reali |

Le baseline `n/a` vanno misurate in tranche 0 con `scripts/bench-startup.mjs`
(Lighthouse CLI web; Electron DevTools Performance; `adb shell am start -W` Android).

---

## 15. Note di sicurezza/privacy

- Tutte le feature D.* non devono esfiltrare dati senza opt-in esplicito.
- Credenziali Xtream sempre cifrate at-rest (P8.3).
- Telemetria **locale** salvo bug report manuale.
- Parental control e statistiche di visione **non escono mai** dal device.
- Companion remote (P8.1): pairing PIN/QR obbligatorio prima di accettare
  comandi.

---

## 16. Comandi utili

```bash
# Stato repo
git status --short

# Validazione
npm run typecheck
npm run test:run
npm run check    # typecheck + test:run + build
npm run build

# Avvio Electron
npm run start
timeout 20s npm run start   # smoke

# Android
npm run android:sync
npm run android:build
npm run android:run

# Audit
npm audit
npm audit --omit=dev
npm outdated

# Lint i18n
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types \
  scripts/check-i18n.mjs

# Test mirati
npm run test:run -- tests/streamInfo
npm run test:run -- tests/ui
```

---

## 17. Checklist pre-merge

- [ ] `git status` pulito o modifiche attese.
- [ ] Nessun `.env` reale nello staging.
- [ ] Nessun `*.keystore`, `*.jks`, APK/AAB nello staging.
- [ ] Nessun asset Android generato nello staging.
- [ ] Nessuna chiave API hardcoded.
- [ ] `npm run typecheck` OK.
- [ ] `npm run test:run` OK (161/161 oggi).
- [ ] `npm run check` OK.
- [ ] `npm run build` OK.
- [ ] Smoke Electron OK se tocca runtime desktop.
- [ ] Android sync/build OK se tocca mobile.
- [ ] README/AGENTS/copilot-instructions aggiornati se cambia comportamento.

---

## Note operative finali

- Le funzionalità identitarie da preservare sempre: **PiP, casting/discovery,
  controllo tastiera/telecomando, OSD, UI coerente cross-platform**.
- Evitare modifiche invasive simultanee a player, casting e Android nella
  stessa tranche.
- Preferire PR/commit piccoli, con verifica chiara.
- Ogni feature su rete locale = considerare anche la sicurezza.
- Ogni feature sul player = testare almeno su Live, VOD, Series.
- **BUG-1 (§2) ha priorità su ogni nuova feature**: una cache "avvelenata"
  blocca completamente la sezione Film.


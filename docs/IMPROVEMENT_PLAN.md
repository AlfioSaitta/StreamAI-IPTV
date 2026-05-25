# StreamAI IPTV — Piano consolidato di miglioramenti, ottimizzazioni e roadmap

> **Documento unico e canonico.** Consolida i precedenti
> `IMPROVEMENT_PLAN.md` (P0-P8) e `IMPROVEMENT_PLAN_V2.md` (URG-1, UI-1, B-K).
> I file separati sono stati rimossi: questo è l'unico piano valido.
>
> **Ultimo aggiornamento:** 2026-05-18
> **Versione corrente (`/.version`):** **1.0.0**
> (single source of truth, propagata via `npm run version:sync`).
> **Baseline reale (da `package.json`):** React **19.2.6**, Vite 5,
> Electron 37, Capacitor 7, Video.js 8.23, hls.js 1.5, mpegts.js 1.7,
> `@google/genai` 1.34, TypeScript strict, Tailwind CSS, Vitest 3.2.
>
> **File chiave:** `App.tsx`, `main.js`, `preload.js`,
> `components/VideoPlayerNew.tsx`, `services/xtream.ts`,
> `services/deviceDiscovery.ts`, `services/advertisingService.js`,
> `services/geminiService.ts`, `services/nativeVideoPlayer.ts`,
> `services/streamInfo/`, `vite.config.ts`,
> `.github/workflows/linux-release.yml`, `scripts/build-linux.sh`,
> `scripts/sign-linux-packages.sh`, `scripts/publish-repo.sh`,
> `scripts/sync-version.mjs`, `android/plugins/capacitor-video-player/`.
>
> ### 🆕 Cambiamenti rilevanti dall'ultimo aggiornamento (2026-05-15 → 2026-05-18)
>
> 1. **🐞 TEST-1 (P0, NUOVO):** la suite Vitest è **rotta**. 6 file di
>    test che usano `@testing-library/react` non si caricano per
>    `Cannot find module '@testing-library/dom'` (peer dep mancante in
>    `package.json`). Stato reale: **13 file passano, 6 falliscono al
>    setup** → 167 test eseguiti su ~207 attesi. `npm run check` di fatto
>    non protegge più tutte le tranche `react/jsx`. Vedi §2-bis.
> 2. **📈 Regressione B.1 — `VideoPlayerNew.tsx` 973 → 1.599 righe.** Il
>    refactor del P1 si è gradualmente eroso (feature: error report copy,
>    OSD aggiuntivi, native bridge, retry). Ri-applicare lo split su
>    sotto-hook è urgente per non perdere il vantaggio di B.1.
> 3. **📈 Crescita hotspot:** `App.tsx` 923 → **1.151**,
>    `ChannelList.tsx` 834 → **966**, `ProfileSettings.tsx` 651 →
>    **938**, `main.js` non era tracciato → **684**.
>    `services/i18n.ts` invece è sceso a **262** righe (la baseline
>    `1.559` era pre-lazy: ora il file è solo il dispatcher).
> 4. **🚀 Pipeline Linux release completata** (commit `449b439` →
>    `bc8ce99`): build per-distro (`opensuse|fedora|rhel|debian|ubuntu|arch`)
>    via `scripts/build-linux.sh`, firma GPG (debsigs + rpm --addsign +
>    gpg detach-sign), verifica strict, SLSA build provenance,
>    pubblicazione APT/RPM/Arch su GitHub Pages via Pages API
>    (`actions/configure-pages` + `upload-pages-artifact` + `deploy-pages`)
>    con cache `pages-history-v1-*` + fallback `gh release download`.
>    Documentato in §4-ter (nuova sezione). G.4 CI passa da ⏳ → 🚧
>    parzialmente (manca solo il job di typecheck/test/build su PR).
> 5. **🔢 Versioning centralizzato (commit `88ec542`):** `/.version` è la
>    fonte di verità; `scripts/sync-version.mjs` propaga in
>    `package.json` + `android/app/build.gradle` (versionName +
>    versionCode). Artefatti CI: `streamai-iptv_${ver}_${sha7}_${distro}_${arch}.${ext}`.
> 6. **📦 Plugin Android vendor (commit `736be6e`):** la cartella
>    `android/plugins/capacitor-video-player/dist/` (368 kB pre-build)
>    è ora tracciata in git per sbloccare il build Vite in CI.
>    Chiusura MED-1 §4-bis Step 8 confermata. Resta gate fisico Gradle.

---

## 📋 Indice

- [0. Convenzioni di gestione del piano](#0-convenzioni-di-gestione-del-piano)
- [📊 1. Stato di completamento globale](#-1-stato-di-completamento-globale-2026-05-18)
- [🐞 2. BUG-1: sezione "Films" sempre vuota](#-2-bug-1-sezione-films-sempre-vuota)
- [🧪 2-bis. TEST-1: suite Vitest rotta (peer dep mancante)](#-2-bis-test-1-suite-vitest-rotta-peer-dep-mancante)
- [🚨 3. URG-1: Seek VOD bloccante](#-3-urg-1-seek-vod-bloccante)
- [🎨 4. UI-1: Design System v1](#-4-ui-1-design-system-v1)
- [🎬 4-bis. MED-1: Migrazione ExoPlayer → AndroidX Media3](#-4-bis-med-1-migrazione-exoplayer--androidx-media3)
- [📦 4-ter. PKG-1: Pipeline Linux release multi-distro firmata](#-4-ter-pkg-1-pipeline-linux-release-multi-distro-firmata)
- [♻️ 4-quater. REF-1: Re-split hotspot post-feature creep](#%EF%B8%8F-4-quater-ref-1-re-split-hotspot-post-feature-creep)
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

## 📊 1. Stato di completamento globale (2026-05-18)

| Area | Stato | Note |
| ---- | ----- | ---- |
| 🐞 **BUG-1 Films sempre vuota** | ✅ Completato | Vedi §2 — cache hardening + retry mirato + UI feedback + 15 test |
| 🧪 **TEST-1 Suite Vitest rotta** | ✅ Completato 2026-05-20 | Vedi §2-bis — peer dep `@testing-library/dom` + `jest-dom` aggiunte, `scripts/check-deps.mjs` cablato in `npm run check`. Suite: **209/209 verdi** |
| 🚨 URG-1 Seek VOD bloccante | ✅ 3/4 livelli | Livello 4 (Range proxy Electron) opzionale |
| 🎨 UI-1 Design System v1 | ✅ 100% | DS v1 + migrazione + accessibilità, 0 occorrenze red/purple |
| 🎬 **MED-1 ExoPlayer → AndroidX Media3 1.10.1** | ✅ codice + CI guard + plugin vendor | Vedi §4-bis — `npm run check:media3` verde, `dist/` plugin committato. **Gate fisico Smoke matrix** aperto (richiede device API 26+ con JDK 17 completo). |
| 📦 **PKG-1 Pipeline Linux release** | ✅ Completato | Vedi §4-ter — 6 pacchetti per-distro firmati, SLSA provenance, APT/RPM/Arch su GitHub Pages via Pages API |
| ♻️ **REF-1 Re-split hotspot post-feature creep** | ⏳ NUOVO | Vedi §4-quater — `VideoPlayerNew` 1.599 (era 973), `App.tsx` 1.151, `ChannelList` 966, `ProfileSettings` 938 |
| 🔢 Versioning centralizzato (`/.version`) | ✅ Completato | `scripts/sync-version.mjs` → `package.json` + `android/app/build.gradle`; CI embedda `${sha7}` negli artefatti |
| P0 Sicurezza runtime | 🚧 | `npm audit` triage, hardening WS remote, IPC validation aperti |
| P1 Bundle iniziale | ✅ | 580 → 146 kB gzip (lazy + auto split) |
| P2 Player Desktop/Android | ✅ | Error handling, PiP native, fallback codec, "Copia report" errore |
| P3 Casting/discovery | ✅ codice | Verifica device fisici aperta |
| P4 UX TV/Android | ✅ codice | Verifica telecomando/TV box reale aperta |
| P5 AI + metadata | ✅ | Cache TTL, fuzzy match, prompt contestuali |
| P6 Catalogo + immagini | ✅ | Indice, virtualizzazione, Cache API + LRU |
| P7 Test automatici | 🟡 ripristinato | TEST-1 chiuso 2026-05-20 → 209/209 verdi. Coverage `services/` ≥50% (P7.1) ancora da misurare |
| P8 Feature future | 🚧 | P8.2 Diagnostica stream ✅; companion/BYOC/parental aperti |
| B.1 Refactor `VideoPlayerNew` | ⚠️ **regredito** | 1542 → 973 → **1.599** (re-split richiesto in §4-quater) |
| B.2 Decomposizione `streamInfoService` | ✅ stabile | 2018 → 1.318 righe (facade `services/streamInfo/`) |
| B.3 i18n lazy | ✅ | `services/i18n.ts` 1.559 → **262**, 11 chunk per-lingua |
| B.4 Routing dichiarativo (`useBackStack`) | ✅ | |
| B.5 Upgrade React 19 | ✅ | `useActionState`, `useTransition` |
| C.1 Cheatsheet shortcut | ✅ | overlay + onboarding al primo avvio profilo + toggle riattivazione |
| C.2 Onboarding profilo | ✅ | wizard 3 step + test Xtream + import M3U remoto |
| C.3 Cmd+K palette | ✅ | recent searches + filtri chip + filtri avanzati |
| C.4 Continua a guardare + auto-next | ✅ | soglia + countdown + toggle per-tipo (film/serie) |
| C.6 Accessibilità | ✅ | font scale S/M/L/XL + icone su badge HD/Match/anno + audit aria-label |
| D.1 EPG (mini + Guide + reminder) | ✅ | Fasi 1-3 |
| D.4 Sottotitoli MVP (SRT/VTT sideload) | 🚧 | manca HLS embed + OpenSub |
| D.5 Sleep timer | ✅ | preset + fine programma |
| D.10 Tema OLED | ✅ | mancano light/auto |
| E.1 Bundle iniziale | ✅ | 580 → 146 kB gzip |
| E.5 Cache API + gzip TMDB | ✅ | |
| F.3 Health-check Xtream | ✅ | badge + alert 7gg |
| G.1 vitest + test moduli puri | ✅ | TEST-1 chiuso 2026-05-20; suite 209/209 |
| G.4 CI GitHub Actions | ✅ | `ci.yml` su push + PR (typecheck + test + check:media3 + check:wails + check:go + build), badge in README. Closed 2026-05-22 |
| K Quick wins | 🚧 | 7/10 (mancano bonjour-service, content-visibility) |

**Test suite (rilevazione 2026-05-18):** **167 test passati su 207 attesi**;
6 file di test (`useBackStack`, `cheatsheet`, `wizard`, `scrubbing`,
`a11y-fontScale`, `shared`) **non si caricano** per `@testing-library/dom`
mancante. Vedi §2-bis per il fix (1 riga in `package.json`).
`npm run typecheck` clean, `npm run build` Vite 5 verde,
`npm run check:media3` verde.

### Hotspot di complessità (file > 700 righe, 2026-05-18)

| File | Righe | Δ vs prev | Rischio |
| ---- | ----: | --------- | ------- |
| **`components/VideoPlayerNew.tsx`** | **1.599** | ⚠ +626 (era 973) | Regressione B.1 — vedi §4-quater REF-1 |
| `services/streamInfoService.ts` | 1.318 | +5 (stabile) | Parsing HLS/TS/codec/bitrate |
| **`App.tsx`** | **1.151** | ⚠ +228 | Stato globale, routing manuale, refresh BG, AI hint |
| `components/ChannelList.tsx` | 966 | ⚠ +132 | Virtualizzazione + ricerca + filtri + Continue Watching per-tipo |
| `services/deviceDiscovery.ts` | 956 | — | Scansione subnet + SSDP + probe TCP |
| `components/ProfileSettings.tsx` | 938 | ⚠ +287 | Tab unica con molte sezioni (onboarding, refresh, font, toggle CW) |
| `services/castService.ts` | 766 | — | Chromecast + DLNA + AirPlay |
| `main.js` | 684 | tracking nuovo | Electron main + advertising + IPC + cast bridge |
| `services/i18n.ts` | 262 | ✅ -1.297 (lazy) | Solo dispatcher, locali in `services/locales/` |

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

## 🧪 2-bis. TEST-1: suite Vitest rotta (peer dep mancante) ✅ chiuso 2026-05-20

> **Priorità: P0 — chiuso 2026-05-20.** `npm run check` torna a proteggere
> l'intero codebase. Storico (rilevato 2026-05-18): la suite girava 167
> test su 207 attesi perché 6 file in *Failed Suites* con
> `Cannot find module '@testing-library/dom'`. Stato attuale: **209/209
> verdi** (la baseline è cresciuta nel frattempo di 2 test).

### 2-bis.1 Cause radice

- `package.json` (riga 53) dichiara solo
  `"@testing-library/react": "16.1.0"`.
- A partire da `@testing-library/react@^16`, **`@testing-library/dom` non
  è più una dependency transitiva** ma una `peerDependency`. Va
  installata esplicitamente, altrimenti l'import di
  `node_modules/@testing-library/react/dist/pure.js:46` fallisce a runtime.
- Le installazioni precedenti probabilmente avevano `dom` in cache npm o
  ereditavano la dep da una versione minor diversa, mascherando il
  problema. Un `rm -rf node_modules && npm ci` (CI / fresh checkout) lo
  espone.

### 2-bis.2 File impattati (6/19)

```
tests/hooks/useBackStack.test.tsx
tests/onboarding/cheatsheet.test.tsx
tests/onboarding/wizard.test.tsx
tests/player/scrubbing.test.tsx
tests/ui/a11y-fontScale.test.tsx
tests/ui/shared.test.tsx
```

Totale test bloccati: **~40** (delta con il claim 207/207 precedente).

### 2-bis.3 Fix (1 riga, ½ giornata smoke) ✅

- [x] Aggiunto a `package.json → devDependencies`:
  ```json
  "@testing-library/dom": "^10.4.0",
  "@testing-library/jest-dom": "^6.6.3"
  ```
- [x] `npm install --legacy-peer-deps` eseguito (flag mantenuto per React 19).
- [x] `npm run test:run` → **209/209 verde** (target era 207).
- [x] `npm run check` → verde (typecheck + test + media3 + wails + go + build).
- [x] Aggiunto `scripts/check-deps.mjs` (regola
  `@testing-library/react` → `@testing-library/dom` + `jest-dom`),
  cablato in `npm run check` come primo step (`check:deps`).
  Un futuro bump non potrà più rompere la suite in silenzio.

### 2-bis.4 Criteri di accettazione ✅

- [x] `npm ci && npm run test:run` da clean checkout: 209/209 verdi.
- [x] Nessun output `Cannot find module '@testing-library/dom'`.
- [x] §1 (stato globale) e §13 aggiornati.

### 2-bis.5 Prevenzione regressioni

- [x] **G.4 — Job CI dedicato** (vedi §11.4): `.github/workflows/ci.yml`
  esegue `npm ci && npm run check` (check:deps + typecheck + test:run +
  check:media3 + check:wails + check:go + build) + `go test ./internal/...`
  su Ubuntu 24.04 + Node 20 LTS + Go 1.25 + libwebkit2gtk-4.1 + libmpv.
  Badge CI nel README. **Chiuso 2026-05-22.**
- [x] `scripts/check-deps.mjs` ora intercetta companion mancanti
  prima dei test (eseguito da `npm run check`).
- [ ] Eseguire `npm explain @testing-library/dom` periodicamente per
  identificare deps con peer mancanti.

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

## 🎬 4-bis. MED-1: Migrazione ExoPlayer → AndroidX Media3

> **Priorità: P1 — debt strutturale Android.** Aggiunto 2026-05-15.
> Il player nativo Android utilizza il plugin Capacitor
> `capacitor-video-player` (fork `@brylsherbert/capacitor-video-player`
> 7.0.32, sorgente `github:phiamo/capacitor-video-player`) che internamente
> dipende da **ExoPlayer 2.19.0** (`com.google.android.exoplayer:exoplayer-*`).
> La libreria standalone **ExoPlayer 2.x è deprecata da marzo 2024** (last
> release `2.19.1`, end-of-life): Google indirizza ufficialmente la
> migrazione a **AndroidX Media3** (`androidx.media3:media3-*`). Restare su
> ExoPlayer 2 significa: nessun fix di sicurezza, nessun supporto Android
> 15/16, nessuna nuova feature (HDR10+, Dolby Vision aggiornato, AV1 SW
> migliorato, MediaSession nuova generazione).

### 4-bis.1 Stato attuale (analisi statica approfondita 2026-05-16)

#### 4-bis.1.a Dipendenze e versioni rilevate

- **Plugin path:** `node_modules/capacitor-video-player/android/`.
- **Pacchetto npm:** `@brylsherbert/capacitor-video-player@7.0.32`, installato
  via `"capacitor-video-player": "github:phiamo/capacitor-video-player"` in
  `package.json`. Upstream `phiamo` non ha commit attivi su Media3.
- **Versione ExoPlayer 2.19.0 (DEPRECATA)** in
  `node_modules/capacitor-video-player/android/build.gradle`:
  ```groovy
  implementation 'com.google.android.exoplayer:exoplayer-core:2.19.0'
  implementation 'com.google.android.exoplayer:exoplayer-ui:2.19.0'
  implementation 'com.google.android.exoplayer:exoplayer-hls:2.19.0'
  implementation 'com.google.android.exoplayer:exoplayer-dash:2.19.0'
  implementation 'com.google.android.exoplayer:exoplayer-smoothstreaming:2.19.0'
  implementation 'com.google.android.exoplayer:extension-mediasession:2.19.0'
  implementation 'com.google.android.exoplayer:exoplayer:2.19.0'
  implementation 'com.google.android.exoplayer:extension-cast:2.19.0'
  implementation 'com.squareup.picasso:picasso:2.71828'
  ```
- **AndroidX coadiuvanti già in uso (restano nella migrazione):**
  - `androidx.mediarouter.app.MediaRouteButton`
  - `androidx.mediarouter.media.MediaRouter` / `MediaRouter.Callback` / `MediaRouteSelector`
  - `android.support.v4.media.session.MediaSessionCompat`
    (legacy `androidx.media:media`) — verrà sostituito da
    `androidx.media3.session.MediaSession`.
  - `com.google.android.gms.cast.framework.CastContext` /
    `com.google.android.gms.cast.framework.CastButtonFactory` (Cast SDK,
    NON parte di Media3 — resta).
- **`android/variables.gradle`** non dichiara `media3Version` né
  `playServicesCastVersion`. compileSdk 36, minSdk 24, targetSdk 36,
  Java 17.
- **HEVC su Electron** (`scripts/patch-ffmpeg.js`) è completamente
  indipendente — non viene toccato dalla migrazione Android.

#### 4-bis.1.b API ExoPlayer 2 effettivamente usate (mappa esaustiva)

Estratto da `node_modules/capacitor-video-player/android/src/main/java/com/jeep/plugin/capacitor/capacitorvideoplayer/`:

| File | Righe | Simboli chiave |
| ---- | ----- | -------------- |
| `FullscreenExoPlayerFragment.java` | 1.410 | `ExoPlayer` (singleton statico), `Player.Listener`, `StyledPlayerView` + `StyledPlayerView.ControllerVisibilityListener`, `AspectRatioFrameLayout` (`RESIZE_MODE_FIT/FILL/ZOOM`), `DefaultTimeBar`, `PlayerControlView`, `MediaItem` + `MediaItem.SubtitleConfiguration`, `MediaMetadata`, `PlaybackParameters`, `DefaultLoadControl`, `LoadControl`, `TrackSelector`, `AdaptiveTrackSelection`, `DefaultTrackSelector`, `DefaultBandwidthMeter`, `DefaultHttpDataSource.Factory`, `DefaultDataSourceFactory`, `HlsMediaSource.Factory`, `DashMediaSource.Factory`, `SsMediaSource.Factory`, `ProgressiveMediaSource.Factory`, `SingleSampleMediaSource.Factory`, `MergingMediaSource`, `CaptionStyleCompat`, `MimeTypes` (`TEXT_VTT`, `APPLICATION_SUBRIP`, `TEXT_SSA`, `APPLICATION_TTML`), `C.ROLE_FLAG_CAPTION`, `C.SELECTION_FLAG_DEFAULT`, `C.TIME_UNSET`, `CastPlayer`, `SessionAvailabilityListener`, `MediaSessionCompat`, `MediaSessionConnector`, `PictureInPictureParams.Builder`, `MediaRouteButton`, `CastContext`, `CastButtonFactory`, `CastStateListener`, `Format` (via `player.getVideoFormat()` per Rational aspect ratio in PiP). |
| `CapacitorVideoPlayerPlugin.java` | 1.307 | Bridge `@CapacitorPlugin`. Espone metodi: `initPlayer`, `isPlaying`, `play`, `pause`, `stop`, `getDuration`, `getCurrentTime`, `setCurrentTime`, `setVolume`, `getVolume`, `setMuted`, `getMuted`, `setRate`, `getRate`, `stopAllPlayers`, `showController`, `isControllerIsFullyVisible`, `exitPlayer`. Opzioni: `mode` (`fullscreen` | `embedded`), `url`, `playerId`, `componentTag`, `title`, `smallTitle`, `accentColor`, `chromecast`, `artwork`, `subtitle`, `language`, `subtitleOptions` (`foregroundColor`, `backgroundColor`, `fontSize`), `headers`, `pipEnabled`, `controls`, `autoPlay`. |
| `CapacitorVideoPlayer.java` | 71 | Stub di facciata. |

**`supportedFormat` dichiarato** (`FullscreenExoPlayerFragment.java:128`):
`["mp4", "webm", "ogv", "3gp", "flv", "dash", "mpd", "m3u8", "ism", "ytube", ""]`.

**Branch `buildHttpMediaSource()` (riga 927)** → selezione `MediaSource` per estensione:
- `mp4 | webm | ogv | 3gp | flv | ""` → `ProgressiveMediaSource.Factory`.
- `dash | mpd` → `DashMediaSource.Factory`.
- `m3u8` → `HlsMediaSource.Factory`.
- `ism` → `SsMediaSource.Factory`.

**Sottotitoli** (`getSubTitle`, riga 980): costruisce
`MediaItem.SubtitleConfiguration` con `C.ROLE_FLAG_CAPTION` +
`C.SELECTION_FLAG_DEFAULT` e li **fonde via `MergingMediaSource`**.
Supporta `.vtt` (`MimeTypes.TEXT_VTT`), `.srt`
(`MimeTypes.APPLICATION_SUBRIP`), `.ssa` / `.ass` (`MimeTypes.TEXT_SSA`),
`.ttml` / `.dfxp` / `.xml` (`MimeTypes.APPLICATION_TTML`).

**Caption styling** (`setSubtitle`, riga 851): usa `CaptionStyleCompat`
con foreground/background configurabili via `subtitleOptions`.

**Cast integration** (righe 1.274-1.360): `CastContext.getSharedInstance(...)`
→ `castPlayer = new CastPlayer(castContext)` + `castPlayer.setSessionAvailabilityListener(...)`.
Sul session start, sposta il `MediaItem` corrente da `exoPlayer` a
`castPlayer.setMediaItem(mediaItem, videoPosition)` e
`styledPlayerView.setPlayer(castPlayer)`.

**MediaSession** (righe 842-846):
```text
mediaSession = new MediaSessionCompat(context, "capacitorvideoplayer");
mediaSessionConnector = new MediaSessionConnector(mediaSession);
mediaSessionConnector.setPlayer(player);
mediaSession.setActive(true);
```

**PiP** (righe 596-650): `pictureInPictureParams = new PictureInPictureParams.Builder()`
con aspect ratio derivato da `player.getVideoFormat()` (`Rational(width, height)`).
Chiamato da `MainActivity.onUserLeaveHint()` (cfr. note P2.2 in §5)
oppure da pulsante dedicato `pipBtn` nel control view.

#### 4-bis.1.c Bridge JS e contratto invariante

`services/nativeVideoPlayer.ts` (260 righe) espone:

```ts
interface CapacitorVideoPlayerPlugin {
  initPlayer(options): Promise<{ result: boolean }>;
  isPlaying({ playerId }): Promise<{ value: boolean }>;
  play({ playerId }): Promise<{ result: boolean }>;
  pause({ playerId }): Promise<{ result: boolean }>;
  stop({ playerId }): Promise<{ result: boolean }>;
  getDuration({ playerId }): Promise<{ value: number }>;
  getCurrentTime({ playerId }): Promise<{ value: number }>;
  setCurrentTime({ playerId, seektime }): Promise<{ result: boolean }>;
  setVolume({ playerId, volume }): Promise<{ result: boolean }>;
  setMuted({ playerId, muted }): Promise<{ result: boolean }>;
  stopAllPlayers(): Promise<{ result: boolean }>;
  addListener(event, fn): Promise<{ remove: () => void }>;
}
```

**Eventi nativi consumati** (`setupListeners`):
`jeepCapVideoPlayerPlay`, `jeepCapVideoPlayerPause`,
`jeepCapVideoPlayerEnded`, `jeepCapVideoPlayerExit`,
`jeepCapVideoPlayerReady`, `jeepCapVideoPlayerCurrentTime`.

**Capability sniffing JS:** `supportsPiP` legge `navigator.userAgent`
(`Android >= 8`). `enterPictureInPicture()` prova
`enterPictureInPicture | enterPip | pip | requestPictureInPicture` in
ordine (compat fork divergenti).

**Hook React di consumo:** `hooks/useNativePlayerEngine.ts`. Si limita
a `init`/`play`/`pause`/`seek`/`setVolume`/`setMuted` + listener →
sincronizza con stato React e `usePlayerOsd`. **Non** dipende dalle
internals Java: la migrazione è trasparente lato hook.

**Detection lato JS** (`components/player/playerUtils.ts:47`
`detectStreamSource`):
- `.m3u8` → HLS (engine `hlsjs` / `videojs`).
- `.mpd` → DASH (engine `videojs`).
- `.ts|.mpeg|.mpg` o Xtream-live extensionless → MPEG-TS (engine `mpegts` / `videojs`).
- `.webm` → WebM progressivo.
- `.mp4|.m4v|.mov` o Xtream movie/series → MP4 progressivo.
- Native engine (`'native'`) usato su Capacitor (`platformService.isNative`).

#### 4-bis.1.d Configurazione Android contestuale (resta invariata)

- **`android/app/src/main/AndroidManifest.xml`**:
  `supportsPictureInPicture="true"`, `resizeableActivity="true"`,
  `screenOrientation="sensorLandscape"`,
  `configChanges="orientation|keyboardHidden|keyboard|screenSize|locale|smallestScreenSize|screenLayout|uiMode|navigation|density"`,
  `android:hardwareAccelerated="true"`, `android:largeHeap="true"`,
  `usesCleartextTraffic="true"`, `network_security_config` per HTTP.
  Permessi: `INTERNET`, `ACCESS_NETWORK_STATE`, `ACCESS_WIFI_STATE`,
  `WAKE_LOCK`, `FOREGROUND_SERVICE`. Feature: `picture_in_picture`,
  `touchscreen` (entrambe non-required).
- **`MainActivity.java`**: immersive landscape (`WindowCompat` +
  `WindowInsetsControllerCompat`), cutout mode `ALWAYS` (API 30+) /
  `SHORT_EDGES` (API 28-29), re-apply su `onPictureInPictureModeChanged`.
  Nessuna API ExoPlayer/Media3 chiamata direttamente: deleghiamo tutto al
  plugin.
- **`capacitor.config.ts`**: `allowMixedContent: true`,
  `captureInput: true`, `server.cleartext: true`. Nessun setting Media3-specific.

### 4-bis.2 Obiettivi (con parità funzionale al pixel)

1. **Aggiornare a AndroidX Media3 `1.10.1`** (pin 2026-05-15). Bumpabile
   solo a patch `1.10.x` senza re-eseguire la smoke matrix. Fallback
   minimo accettato: `1.4.1`. Riferimento ufficiale:
   <https://developer.android.com/jetpack/androidx/releases/media3>.
2. **Zero regressioni di codec.** Tutti i codec **video** oggi
   riproducibili su Android devono restarlo (vedi matrice §4-bis.11):
   H.264/AVC (Baseline/Main/High, profilo 4.x e 5.x), H.265/HEVC
   (Main/Main10, HDR10/HDR10+/Dolby Vision quando supportato dall'OEM),
   VP8, VP9 (Profile 0/2 inclusi HDR), AV1 (Main Profile, decoder SW
   `media3-decoder-av1` opzionale o HW), MPEG-2 Video, MPEG-4 Part 2,
   H.263 (3GP legacy).
3. **Zero regressioni di codec audio.** AAC LC/HE-AACv1/HE-AACv2/AAC-ELD,
   MP3, Vorbis, Opus, FLAC, AC-3 / E-AC-3 (Dolby Digital / DD+, anche
   passthrough Bluetooth/HDMI dove l'OEM lo espone), AC-4 (Atmos),
   DTS / DTS-HD / DTS-Express (passthrough), PCM, AMR-NB/WB.
4. **Zero regressioni sui container/protocolli** dichiarati in
   `supportedFormat` + quelli derivati: MP4/MOV/M4V, WebM, OGG/OGV, 3GP,
   FLV, MKV (Matroska — Media3 lo supporta via `MatroskaExtractor`,
   anche se non era nella lista whitelist; vedi §4-bis.6 Step 3-bis),
   MPEG-TS (Progressive over HTTP via `TsExtractor`), DASH (`.mpd`),
   HLS (`.m3u8`), SmoothStreaming (`.ism`/`.isml`).
5. **Zero regressioni sui sottotitoli:** WebVTT, SRT (SubRip), SSA/ASS,
   TTML/DFXP/XML (sideload SingleSampleMediaSource), **+ embed
   CEA-608/708** dentro HLS/TS e **WebVTT in-HLS**.
6. **Feature trasversali preservate:**
   - PiP Android con aspect ratio dinamico (`Rational(width, height)`).
   - MediaSession (lock screen + Bluetooth + cuffie + Android Auto base).
   - Chromecast fallback Media3 (`CastPlayer`) + MediaRouter button.
   - HTTP headers custom (User-Agent, Authorization, cookies Xtream).
   - Resize mode FIT/FILL/ZOOM ciclico (`AspectRatioFrameLayout`).
   - Caption styling (foreground/background/font size).
   - Seek, volume, mute, playback rate, autoplay, poster, live edge.
   - Retry esponenziale lato JS (`useNativePlayerEngine` →
     `scheduleRetry` + `classifyPlaybackError`).
7. **API JS invariata:** `services/nativeVideoPlayer.ts` resta byte-per-byte
   identico. La firma del plugin Capacitor non cambia.
8. **Vendor del plugin in-tree** in `android/plugins/capacitor-video-player/`
   per indipendenza dall'upstream orfano e patch idempotente in CI.

### 4-bis.3 Strategia (3 opzioni — decisione richiesta in Step 0)

| Opzione | Vantaggi | Costi | Rischi |
| ------- | -------- | ----- | ------ |
| **A. Fork interno del plugin (vendor + porting Java)** ⭐ raccomandata | Controllo totale, niente dipendenza GitHub orfana, possiamo aggiungere feature (tracce audio multiple, HDR toggle, EXO-renderers AV1 SW) | ~5 g porting + smoke | `MediaSessionConnector` → `MediaSession` è riscrittura non meccanica |
| B. Adottare plugin community già su Media3 | Meno codice nostro | Nessun plugin Capacitor Media3 maturo allo stato dell'arte (verificato 2026-05-16: nessun match su npm con `capacitor` + `media3` + manutenzione attiva) | Feature gap (cast, mediasession, sottotitoli SRT/SSA/TTML) da verificare |
| C. Scrivere plugin Capacitor custom da zero | Architettura pulita, niente debito ereditato | 8-10 g sviluppo + test | Massimo lavoro, retake completo del fragment fullscreen + control view |

> **Decisione di default (rivedibile):** Opzione **A** — vendor + porting,
> perché il plugin attuale è già un fork di un fork e l'upstream non è
> manutenuto da > 18 mesi. Opzione C resta come fallback strategico per
> tranche future (D.4 audio tracks + D.4 OpenSubtitles).

### 4-bis.4 Tabella di mapping API (ExoPlayer 2 → Media3 1.10.1)

> Mappatura completa basata sul grep effettivo del plugin
> (`FullscreenExoPlayerFragment.java`). Le righe contrassegnate con ⚠
> richiedono intervento manuale (non meccanico).

| ExoPlayer 2.19 | AndroidX Media3 1.10.1 | Note |
| -------------- | ---------------------- | ---- |
| `com.google.android.exoplayer2.SimpleExoPlayer` | `androidx.media3.exoplayer.ExoPlayer` (via `ExoPlayer.Builder`) | `SimpleExoPlayer` rimosso |
| `com.google.android.exoplayer2.ExoPlayer` | `androidx.media3.exoplayer.ExoPlayer` | Builder pattern obbligatorio |
| `com.google.android.exoplayer2.C` | `androidx.media3.common.C` | Constants `ROLE_FLAG_CAPTION`, `SELECTION_FLAG_DEFAULT`, `TIME_UNSET` invariate |
| `com.google.android.exoplayer2.MediaItem` (+ `.SubtitleConfiguration`) | `androidx.media3.common.MediaItem` (+ `.SubtitleConfiguration`) | API identica |
| `com.google.android.exoplayer2.Player` | `androidx.media3.common.Player` | `STATE_IDLE/BUFFERING/READY/ENDED` invariati |
| `com.google.android.exoplayer2.Player.Listener` | `androidx.media3.common.Player.Listener` | Già usato (no `EventListener`) |
| `com.google.android.exoplayer2.PlaybackParameters` | `androidx.media3.common.PlaybackParameters` | |
| `com.google.android.exoplayer2.MediaMetadata` | `androidx.media3.common.MediaMetadata` | |
| `com.google.android.exoplayer2.Format` | `androidx.media3.common.Format` | `Format.width/height/codecs/colorInfo` usati per Rational PiP + diagnostica |
| `com.google.android.exoplayer2.audio.AudioAttributes` | `androidx.media3.common.AudioAttributes` | |
| `com.google.android.exoplayer2.util.MimeTypes` | `androidx.media3.common.MimeTypes` | `TEXT_VTT`, `APPLICATION_SUBRIP`, `TEXT_SSA`, `APPLICATION_TTML` invariati |
| `com.google.android.exoplayer2.source.hls.HlsMediaSource[.Factory]` | `androidx.media3.exoplayer.hls.HlsMediaSource[.Factory]` | `setAllowChunklessPreparation(true)` consigliato in Media3 per ridurre TTFF |
| `…source.dash.DashMediaSource[.Factory]` | `androidx.media3.exoplayer.dash.DashMediaSource[.Factory]` | |
| `…source.smoothstreaming.SsMediaSource[.Factory]` | `androidx.media3.exoplayer.smoothstreaming.SsMediaSource[.Factory]` | |
| `…source.ProgressiveMediaSource[.Factory]` | `androidx.media3.exoplayer.source.ProgressiveMediaSource[.Factory]` | Default extractor list copre MP4/MKV/WebM/OGG/FLV/3GP/TS/FLAC/ADTS/AMR |
| `…source.SingleSampleMediaSource[.Factory]` | `androidx.media3.exoplayer.source.SingleSampleMediaSource[.Factory]` | Usato per subtitle sideload |
| `…source.MergingMediaSource` | `androidx.media3.exoplayer.source.MergingMediaSource` | Audio+video+subs |
| `…source.MediaSource[.Factory]` | `androidx.media3.exoplayer.source.MediaSource[.Factory]` | Interface |
| `…trackselection.AdaptiveTrackSelection[.Factory]` | `androidx.media3.exoplayer.trackselection.AdaptiveTrackSelection[.Factory]` | |
| `…trackselection.DefaultTrackSelector` | `androidx.media3.exoplayer.trackselection.DefaultTrackSelector` | API `setParameters(...)` allargata |
| `…trackselection.TrackSelector` | `androidx.media3.exoplayer.trackselection.TrackSelector` | |
| `…trackselection.ExoTrackSelection` | `androidx.media3.exoplayer.trackselection.ExoTrackSelection` | |
| `…ui.StyledPlayerView` | `androidx.media3.ui.PlayerView` | ⚠ `StyledPlayerView` rimosso/unificato in `PlayerView` (anche `StyledPlayerView.ControllerVisibilityListener` → `PlayerView.ControllerVisibilityListener`) |
| `…ui.AspectRatioFrameLayout` | `androidx.media3.ui.AspectRatioFrameLayout` | `RESIZE_MODE_FIT/FILL/ZOOM/FIXED_WIDTH/FIXED_HEIGHT` invariati |
| `…ui.DefaultTimeBar` | `androidx.media3.ui.DefaultTimeBar` | |
| `…ui.PlayerControlView` | `androidx.media3.ui.PlayerControlView` | `VisibilityListener` con stessa firma |
| `…ui.CaptionStyleCompat` | `androidx.media3.ui.CaptionStyleCompat` | `EDGE_TYPE_NONE` invariato |
| `…upstream.DataSource[.Factory]` | `androidx.media3.datasource.DataSource[.Factory]` | |
| `…upstream.DefaultDataSourceFactory` | `androidx.media3.datasource.DefaultDataSource.Factory` | ⚠ ridenominato e ora **nested class** di `DefaultDataSource` |
| `…upstream.DefaultHttpDataSource[.Factory]` | `androidx.media3.datasource.DefaultHttpDataSource[.Factory]` | `setUserAgent`, `setConnectTimeoutMs`, `setReadTimeoutMs`, `setAllowCrossProtocolRedirects`, `setDefaultRequestProperties(Map)` invariati |
| `…upstream.DefaultBandwidthMeter` | `androidx.media3.exoplayer.upstream.DefaultBandwidthMeter` | |
| `…DefaultLoadControl[.Builder]` | `androidx.media3.exoplayer.DefaultLoadControl[.Builder]` | `setBufferDurationsMs` invariato |
| `…LoadControl` | `androidx.media3.exoplayer.LoadControl` | |
| `…DefaultRenderersFactory` (non in uso, ma utile) | `androidx.media3.exoplayer.DefaultRenderersFactory` | Da introdurre per `setEnableDecoderFallback(true)` e `EXTENSION_RENDERER_MODE_PREFER` (AV1/FFmpeg) |
| `…ext.mediasession.MediaSessionConnector` | `androidx.media3.session.MediaSession` (+ opzionalmente `MediaSessionService`) | ⚠ **Riscrittura non meccanica** — niente più connector |
| `android.support.v4.media.session.MediaSessionCompat` | rimuovere (sostituito da `androidx.media3.session.MediaSession`) | ⚠ |
| `…ext.cast.CastPlayer` | `androidx.media3.cast.CastPlayer` | API quasi 1:1 |
| `…ext.cast.SessionAvailabilityListener` | `androidx.media3.cast.SessionAvailabilityListener` | |
| `com.google.android.gms.cast.framework.CastContext` | **invariato** (Cast SDK, non Media3) | |
| `com.google.android.gms.cast.framework.CastButtonFactory` | **invariato** | |
| `androidx.mediarouter.app.MediaRouteButton` | **invariato** (AndroidX MediaRouter) | |
| `androidx.mediarouter.media.MediaRouter` | **invariato** | |
| `com.squareup.picasso.Picasso` | **invariato** (artwork loader) | |
| `…AnalyticsListener` (eventuale uso futuro) | `androidx.media3.exoplayer.analytics.AnalyticsListener` | Utile per `StreamDiagnostics` lato P8.2 |

### 4-bis.5 Dipendenze Gradle target

`android/variables.gradle` (aggiungere):

```groovy
ext {
    // …existing (minSdk 24, compileSdk 36, targetSdk 36)…
    media3Version = '1.10.1'           // pin stabile 2026-05-15; bump solo a patch 1.10.x
    playServicesCastVersion = '21.5.0' // richiesto da media3-cast
}
```

`android/plugins/capacitor-video-player/build.gradle` (post-vendor):

```groovy
dependencies {
    // RIMUOVERE le 8 implementation com.google.android.exoplayer:*:2.19.0

    // Core + protocolli (HLS/DASH/SS/Progressive con extractor MP4/MKV/WebM/OGG/3GP/FLV/TS/FLAC/ADTS/AMR)
    implementation "androidx.media3:media3-exoplayer:$media3Version"
    implementation "androidx.media3:media3-exoplayer-hls:$media3Version"
    implementation "androidx.media3:media3-exoplayer-dash:$media3Version"
    implementation "androidx.media3:media3-exoplayer-smoothstreaming:$media3Version"

    // UI (PlayerView, ControlView, TimeBar, SubtitleView)
    implementation "androidx.media3:media3-ui:$media3Version"

    // MediaSession nuova generazione (sostituisce extension-mediasession)
    implementation "androidx.media3:media3-session:$media3Version"

    // Chromecast (sostituisce extension-cast)
    implementation "androidx.media3:media3-cast:$media3Version"
    implementation "com.google.android.gms:play-services-cast-framework:$playServicesCastVersion"

    // Datasource + Common (necessari come deps esplicite per Media3 1.10)
    implementation "androidx.media3:media3-datasource:$media3Version"
    implementation "androidx.media3:media3-common:$media3Version"
    implementation "androidx.media3:media3-extractor:$media3Version"

    // Opzionale ma RACCOMANDATO per IPTV: decoder SW di fallback
    // implementation "androidx.media3:media3-decoder:$media3Version"
    // implementation "androidx.media3:media3-exoplayer-ima:$media3Version"  // SOLO se serve ads
    // implementation "androidx.media3:media3-datasource-okhttp:$media3Version"  // SOLO se vogliamo cookie store unificato

    // AndroidX coadiuvanti (restano come da plugin originale)
    implementation "androidx.appcompat:appcompat:$androidxAppCompatVersion"
    implementation 'androidx.mediarouter:mediarouter:1.7.0'
    implementation 'androidx.coordinatorlayout:coordinatorlayout:1.2.0'
    implementation 'androidx.recyclerview:recyclerview:1.3.2'
    implementation 'androidx.cardview:cardview:1.0.0'
    implementation 'androidx.gridlayout:gridlayout:1.0.0'
    implementation 'androidx.constraintlayout:constraintlayout:2.1.4'

    // Picasso resta come da plugin originale
    implementation 'com.squareup.picasso:picasso:2.71828'

    testImplementation "junit:junit:$junitVersion"
    androidTestImplementation "androidx.test.ext:junit:$androidxJunitVersion"
    androidTestImplementation "androidx.test.espresso:espresso-core:$androidxEspressoCoreVersion"
}
```

> **Nota copertura codec.** Media3 `media3-exoplayer` + `media3-extractor`
> coprono **out-of-the-box**: H.264, H.265, VP8, VP9, AV1 (HW), MPEG-2,
> MPEG-4 Part 2, AAC, MP3, Vorbis, Opus, FLAC, AC-3, E-AC-3, AC-4,
> Raw/PCM, AMR-NB/WB, in container MP4/Matroska/WebM/OGG/3GP/FLV/MPEG-TS/MP3/FLAC/WAV/AAC-ADTS.
> Per AV1 SW (device sprovvisti di decoder HW) si può abilitare il
> renderer extension AV1 in tranche separata (cfr. nota in §4-bis.6 Step 3-bis).

### 4-bis.6 Roadmap operativa (step incrementali)

#### Step 0 — Decisione strategia & vendor del plugin (0.3 g)

- [x] Confermata Opzione **A** (fork interno).
- [x] Versione Media3 pinnata a **`1.10.1`** in `android/variables.gradle`
  (`media3Version`) e nel `build.gradle` del plugin vendorato.
- [x] Plugin copiato in `android/plugins/capacitor-video-player/`
  (rimossi `build/`, `node_modules/`, `ios/`, `*.bak`, `.podspec`).
- [x] `android/capacitor.settings.gradle` proietta il progetto Gradle su
  `./plugins/capacitor-video-player/android` (con nota che `npx cap sync`
  rigenera il file → ri-applicare la proiezione locale se necessario).
- [x] `package.json` ora usa `"capacitor-video-player": "file:android/plugins/capacitor-video-player"`.
- [x] `android/plugins/capacitor-video-player/README.md` creato con
  rationale fork + lista patch applicate + versioni pinnate.

#### Step 0-bis — Snapshot funzionale "before" (0.3 g)

> **Scopo:** baseline misurabile per verificare zero regressioni.

- [ ] Catturare con device API 26+ (o emulatore con codec HEVC):
  - Tempi cold-start fullscreen su HLS live + VOD MP4 (3 misure media).
  - Codec effettivamente in uso (`player.getVideoFormat().codecs`,
    `player.getAudioFormat().codecs`) loggati per: HLS H.264+AAC,
    HLS HEVC+E-AC-3, MP4 H.264+AAC, MPEG-TS H.264+AAC.
  - Throughput HLS (`AnalyticsListener.onBandwidthEstimate`).
  - 1 screenshot per resize mode (FIT/FILL/ZOOM).
  - Snapshot lock-screen controls con MediaSessionConnector attivo.
- [ ] Salvare in `docs/assets/med1-baseline/` (gitignored se
  contengono PII), tenere link nel PR.

#### Step 1 — Bump dipendenze Gradle (0.2 g) ✅

- [x] Aggiunti `media3Version = '1.10.1'` e `playServicesCastVersion =
  '21.5.0'` in `android/variables.gradle`.
- [x] Riscritto blocco `dependencies` del plugin vendorato
  (`android/plugins/capacitor-video-player/android/build.gradle`):
  rimosse 8 `implementation com.google.android.exoplayer:*:2.19.0`,
  aggiunte 10 `androidx.media3:*:1.10.1` + `play-services-cast-framework`.
- [x] `compileSdk 36`, `minSdk 24`, `targetSdk 36`, `buildFeatures.buildConfig
  true`, Java 17.
- [ ] **Gate fisico:** `./gradlew :capacitor-video-player:assembleDebug
  --warning-mode=all` (richiede JDK 17 completo, vedi nota P2.2).

#### Step 2 — Porting import Java (1 g) ✅

- [x] Applicato lo script `sed` di mapping API completo su
  `android/plugins/capacitor-video-player/.../*.java`:
  `com.google.android.exoplayer2.*` → `androidx.media3.*`. Coperti:
  `C`, `MediaItem`, `MediaMetadata`, `Player` (+ `Player.Listener`),
  `Format`, `AudioAttributes`, `MimeTypes`, `ExoPlayer`,
  `DefaultLoadControl` / `LoadControl`, `DefaultRenderersFactory`,
  `AdaptiveTrackSelection` / `DefaultTrackSelector` / `ExoTrackSelection`
  / `TrackSelector`, `DataSource` / `DefaultHttpDataSource` /
  `DefaultBandwidthMeter`, `PlayerView` (ex `StyledPlayerView`),
  `AspectRatioFrameLayout`, `DefaultTimeBar`, `PlayerControlView`,
  `CaptionStyleCompat`, `HlsMediaSource` / `DashMediaSource` /
  `SsMediaSource`, `ProgressiveMediaSource` / `SingleSampleMediaSource` /
  `MergingMediaSource`, `CastPlayer` / `SessionAvailabilityListener`.
- [x] **Manuali (non sostituibili con sed):**
  - `new SimpleExoPlayer.Builder(...)` → `new ExoPlayer.Builder(...)`.
  - `new DefaultDataSourceFactory(context, "jeep-exoplayer-plugin")` →
    `new DefaultDataSource.Factory(context,
    new DefaultHttpDataSource.Factory().setUserAgent("jeep-exoplayer-plugin"))`.
  - `new DefaultDataSourceFactory(context, httpDataSourceFactory)` →
    `new DefaultDataSource.Factory(context).setUpstreamDataSourceFactory(httpDataSourceFactory)`.
  - `Util.SDK_INT` (`com.google.android.exoplayer2.util.Util`, ora marker
    `@UnstableApi` in Media3) → `android.os.Build.VERSION.SDK_INT`.
  - `player.prepare(mediaSource, false, false)` (API rimossa) →
    `player.setMediaSource(mediaSource); player.prepare();`.
  - `player.getCurrentWindowIndex()` →
    `player.getCurrentMediaItemIndex()`.
  - `player.REPEAT_MODE_*` (accesso statico via istanza) →
    `Player.REPEAT_MODE_*`.
- [x] XML layout `fragment_fs_exoplayer.xml`,
  `exo_playback_control_view.xml`, `exoplayer_layout_youtube.xml`
  aggiornati. Tutti gli attributi `app:show_buffering`, `app:resize_mode`,
  `app:player_layout_id`, `app:controller_layout_id` invariati (Media3
  mantiene lo stesso schema XML).
- [x] `@androidx.media3.common.util.UnstableApi` applicato a livello
  classe su `FullscreenExoPlayerFragment` per opt-in alle API ancora
  unstable in Media3 (HLS/DASH/SS factory, LoadControl, RenderersFactory,
  TrackSelector).
- [x] **CI guard** `scripts/check-media3-migration.mjs` esegue grep
  ricorsivo su `android/plugins/` e `android/app/src/` (skip commenti);
  integrato in `npm run check` (script `check:media3`). Verde su
  `npm run check:media3`.
#### Step 3 — Riscrittura MediaSession (1 g, **breaking**) ✅

> `MediaSessionConnector` non esiste in Media3. Sostituirlo con la nuova
> `androidx.media3.session.MediaSession` che è auto-bound al `Player`.

- [ ] Rimuovere imports/campi:
  ```text
  // RIMUOVERE
  import android.support.v4.media.session.MediaSessionCompat;
  import com.google.android.exoplayer2.ext.mediasession.MediaSessionConnector;
  private MediaSessionCompat mediaSession;
  private MediaSessionConnector mediaSessionConnector;
  ```
- [ ] Aggiungere:
  ```text
  import androidx.media3.session.MediaSession;
  // ...
  private MediaSession mediaSession;
  ```
- [ ] Init (sostituire le righe 842-846 di `FullscreenExoPlayerFragment.java`):
  ```text
  // Media3: MediaSession forwarda automaticamente play/pause/seek/skip al Player.
  mediaSession = new MediaSession.Builder(context, player)
      .setId("streamai-fullscreen-player")
      .build();
  ```
- [ ] Rilascio (cercare il blocco `mediaSession.setActive(false)` ~r.724):
  ```text
  if (mediaSession != null) {
      mediaSession.release();
      mediaSession = null;
  }
  ```
- [ ] Metadati lock-screen: settati via `MediaItem.Builder()`
  `.setMediaMetadata(new MediaMetadata.Builder()
      .setTitle(title)
      .setSubtitle(smallTitle)
      .setArtworkUri(Uri.parse(artwork))
      .build())`. La `MediaSession` Media3 prende automaticamente
  questi metadata e li pubblica al Notification + lock screen.
- [ ] **Opzionale (rinviabile a tranche futura):** introdurre
  `MediaSessionService` per controllo persistente quando l'app va in
  background. Richiede una `Service` class + entry in `AndroidManifest.xml`.
  Non necessario per lo scenario fullscreen-only attuale; documentare
  in `android/plugins/capacitor-video-player/README.md` come "Future
  work — D.5 audio-only mode".

#### Step 3-bis — Configurare codec/renderer fallback (0.5 g, **critico**) ✅

> **Garanzia parità codec.** Senza questo step, alcuni device OEM
> potrebbero rifiutare HEVC HW e cadere silenziosamente; con Media3
> `DefaultRenderersFactory` possiamo abilitare il fallback SW.

- [ ] In `setupPlayer()` di `FullscreenExoPlayerFragment.java`:
  ```text
  DefaultRenderersFactory renderersFactory =
      new DefaultRenderersFactory(context)
          .setEnableDecoderFallback(true)                            // HEVC HW → fallback decoder alternativo
          .setExtensionRendererMode(
              DefaultRenderersFactory.EXTENSION_RENDERER_MODE_PREFER); // usa decoder extension se disponibili

  player = new ExoPlayer.Builder(context, renderersFactory)
      .setTrackSelector(trackSelector)
      .setLoadControl(loadControl)
      .setBandwidthMeter(bandwidthMeter)
      .build();
  ```
- [ ] `DefaultTrackSelector` con parametri estesi (HDR + multi-lingua):
  ```text
  trackSelector = new DefaultTrackSelector(context);
  trackSelector.setParameters(
      trackSelector.buildUponParameters()
          .setPreferredAudioLanguage(Locale.getDefault().getLanguage())
          .setPreferredTextLanguage(Locale.getDefault().getLanguage())
          .setSelectUndeterminedTextLanguage(true)
          .setTunnelingEnabled(true)        // tunneling HW per HDR/4K dove supportato
          .build()
  );
  ```
- [ ] **HLS:** in `HlsMediaSource.Factory(dataSourceFactory)
  .setAllowChunklessPreparation(true)` per stream HLS con multivariant
  playlist senza segment probe (TTFF -300ms tipici su provider Xtream).
- [ ] **DASH:** verificare che `setAllowChunklessPreparation(true)`
  equivalente sia su (vale per HLS, in DASH non serve).
- [ ] **Buffer tuning IPTV-friendly** (più aggressivo dei default
  Media3, allineato a quanto già fa il plugin):
  ```text
  loadControl = new DefaultLoadControl.Builder()
      .setBufferDurationsMs(
          /* minBufferMs */            15_000,
          /* maxBufferMs */            50_000,
          /* bufferForPlaybackMs */     1_500,
          /* bufferForPlaybackAfterRebufferMs */ 5_000)
      .setPrioritizeTimeOverSizeThresholds(true)
      .build();
  ```
- [ ] **AV1 SW fallback (opzionale, rinviabile):** se la matrice device
  mostra spike di errori AV1 su API < 31, aggiungere
  `implementation "androidx.media3:media3-decoder-av1:$media3Version"`
  e settare `EXTENSION_RENDERER_MODE_PREFER`.

#### Step 3-ter — Container & sottotitoli (parità + bonus, 0.3 g)

> Garantire che ogni formato della §4-bis.11 continui a funzionare e
> che nuovi formati (es. MKV) siano riconosciuti senza branch.

- [ ] In `buildHttpMediaSource()` (riga 927): mantenere lo `switch`
  per estensione, ma per ogni branch usare `MediaItem.Builder()` invece
  di `MediaItem.fromUri(uri)` così possiamo allegare le
  `SubtitleConfiguration` direttamente (best-practice Media3):
  ```text
  MediaItem.Builder b = new MediaItem.Builder().setUri(uri);
  if (sturi != null) {
      b.setSubtitleConfigurations(java.util.Collections.singletonList(
          new MediaItem.SubtitleConfiguration.Builder(sturi)
              .setMimeType(subtitleMimeType)
              .setLanguage(language)
              .setLabel(languageLabel)
              .setRoleFlags(C.ROLE_FLAG_CAPTION)
              .setSelectionFlags(C.SELECTION_FLAG_DEFAULT)
              .build()));
  }
  MediaItem mediaItem = b.build();
  ```
  Con questa forma Media3 gestisce internamente il merge audio+video+subs
  via `MergingMediaSource` quando l'engine è `ProgressiveMediaSource`,
  ma per HLS il flusso può anche embeddare WebVTT/CEA-608 nativamente.
- [ ] **Aggiungere supporto MKV esplicito:** estendere `supportedFormat`
  con `mkv | matroska` → branch `ProgressiveMediaSource` (Media3
  riconosce MKV via `MatroskaExtractor` di default; il branch serve
  solo per detection lato JS in futuro).
- [ ] **CEA-608/708 (closed captions su HLS/MPEG-TS):** abilitato di
  default da `HlsMediaSource`. Verificare che `PlayerView.setShowSubtitleButton(true)`
  sia attivo (cfr. Step 2 — proprietà del PlayerView in XML).
- [ ] Mapping MIME sub (riga 1006): invariato post-sed (`MimeTypes`
  ridenominato). Verificare aggiunta `mks` per Matroska subs:
  ```text
  } else if (extension.equals("mks")) {
      mimeType = MimeTypes.APPLICATION_MATROSKA;  // se necessario, altrimenti fallback
  }
  ```

#### Step 4 — Cast extension Media3 (0.5 g) ✅

- [ ] Sostituire import `com.google.android.exoplayer2.ext.cast.CastPlayer`
  → `androidx.media3.cast.CastPlayer`. API quasi 1:1.
- [ ] `castPlayer = new CastPlayer(castContext);` resta invariato come
  firma.
- [ ] `castPlayer.setSessionAvailabilityListener(...)` invariato
  (interfaccia con stessi callback `onCastSessionAvailable` /
  `onCastSessionUnavailable`).
- [ ] `castPlayer.setMediaItem(mediaItem, videoPosition)` → invariato.
- [ ] `playerView.setPlayer(castPlayer)` / `playerView.setPlayer(player)`
  → invariato (toggle tra local e cast player).
- [ ] Verificare che `play-services-cast-framework` 21.5.0 sia risolto
  (Step 1). `./gradlew :app:dependencies | grep play-services-cast`.
- [ ] **NB:** il casting "primario" di StreamAI passa già da
  `services/castService.ts` (Chromecast / DLNA / AirPlay via JS/IPC
  Electron). `CastPlayer` di Media3 è usato dal plugin solo come
  fallback Android-only (apparirà quando l'utente tocca il
  `MediaRouteButton` nel control view nativo). Mantenere parità
  funzionale: niente regressione né doppio cast.

#### Step 5 — PiP, layout e attributi UI (0.3 g) ✅

- [ ] `PictureInPictureParams.Builder` e `Rational(width, height)` da
  `player.getVideoFormat()`: invariato (API Android, non Media3).
- [ ] In `MainActivity.java`: nessuna modifica (immersive + cutout già
  ortogonali alla migrazione).
- [ ] `AndroidManifest.xml` invariato (`supportsPictureInPicture="true"`,
  `screenOrientation="sensorLandscape"`, ecc.).
- [ ] **Attributi `PlayerView`** da verificare in `fragment_fs_exoplayer.xml`:
  - `app:show_buffering="when_playing"` ✓
  - `app:resize_mode="fit|fill|zoom|fixed_width|fixed_height"` ✓
  - `app:use_controller="true|false"` ✓
  - `app:controller_layout_id="@layout/exo_playback_control_view"` ✓
  - `app:player_layout_id="@layout/exo_player_view"` ✓ (Media3 espone
    sempre `R.layout.exo_player_view`)
  - `app:subtitle_view_size` se usato.
- [ ] **ID drawable `exo_*`** in `exo_playback_control_view.xml`:
  Media3 mantiene gli stessi nomi (`@id/exo_play_pause`, `@id/exo_position`,
  `@id/exo_duration`, `@id/exo_progress`, `@id/exo_rew`, `@id/exo_ffwd`).
  Verificare che `findViewById(R.id.exo_progress)` (riga 152) continui
  a risolvere `DefaultTimeBar`.

#### Step 6 — ProGuard / R8 / opt-in (0.2 g) ✅

- [ ] Aggiungere a `android/app/proguard-rules.pro`:
  ```
  # Media3
  -keep class androidx.media3.** { *; }
  -keep interface androidx.media3.** { *; }
  -dontwarn androidx.media3.**

  # Google Cast (Play Services)
  -keep class com.google.android.gms.cast.** { *; }
  -keep interface com.google.android.gms.cast.** { *; }

  # Picasso (artwork)
  -dontwarn com.squareup.picasso.**
  ```
- [ ] Verificare build `release`:
  `cd android && ./gradlew :app:assembleRelease --no-daemon`.
- [ ] Verificare APK size delta con `apkanalyzer` (target ±2 MB).

#### Step 7 — Smoke matrix Android (0.7 g, **gate di rilascio**)

> **Bloccante:** richiede device fisico o emulatore API 26+ con JDK 17
> completo (cfr. nota P2.2 in §5). Comparare ogni cella con baseline
> Step 0-bis.

**Codec video:**
- [ ] **H.264** Baseline/Main/High (Live HLS + VOD MP4): play, pausa,
  seek, resize FIT/FILL/ZOOM.
- [ ] **H.265/HEVC** Main10 4K HDR10 (se provider/device disponibile):
  decoder HW preferito, fallback SW solo se OEM ha decoder buggy.
- [ ] **VP9** (WebM, raro su IPTV): play + seek.
- [ ] **AV1** (DASH, raro): play su API 31+. Su API < 31 verificare
  fallback graceful (errore esplicito, non crash).
- [ ] **MPEG-2** (DVB-T over IP): play.
- [ ] **MPEG-4 Part 2** (file vecchi 3GP/AVI): play.

**Codec audio:**
- [ ] **AAC-LC** stereo (canale standard): play, volume, mute.
- [ ] **HE-AAC / HE-AACv2** (canali low-bitrate): play.
- [ ] **MP3** (radio streams): play.
- [ ] **AC-3 / E-AC-3** (Dolby Digital + DD+) 5.1: passthrough su HDMI
  TV box se supportato. Verificare canale audio corretto in MediaCodec.
- [ ] **AC-4** (Atmos via passthrough): test su device compatibile,
  fallback graceful altrove.
- [ ] **Opus / Vorbis** (WebM): play.
- [ ] **FLAC** (raro su IPTV ma supportato): play.

**Container & protocolli:**
- [ ] **HLS Live** (`.m3u8`): play / pausa / seek a -30s / cambio canale,
  TTFF < 3 s, no buffering ricorrente.
- [ ] **HLS VOD** (`.m3u8`): seek puntuale, EXT-X-MAP fMP4, multi-audio.
- [ ] **DASH** (`.mpd`): manifest live + VOD, multi-bitrate adattivo.
- [ ] **SmoothStreaming** (`.ism`): se disponibile.
- [ ] **MP4 progressivo** (`.mp4`/`.m4v`/`.mov`): seek + URL.5xx retry.
- [ ] **MPEG-TS over HTTP** (`.ts` o Xtream extensionless live): play < 3 s,
  decode hardware H.264 visibile in logcat `MediaCodec`.
- [ ] **WebM** (`.webm`): play VP9 + Opus.
- [ ] **MKV** (`.mkv`): play H.264+AAC; H.265+AC-3 se OEM lo permette.
- [ ] **3GP / FLV / OGV**: smoke veloce, no crash.

**Sottotitoli:**
- [ ] Sideload `.vtt`: caricamento + toggle visibilità + reset al cambio
  canale + styling (foreground/background/font size dalle
  `subtitleOptions`).
- [ ] Sideload `.srt`: idem.
- [ ] Sideload `.ssa` / `.ass`: rendering + styling preservato.
- [ ] Sideload `.ttml` / `.dfxp` / `.xml`: rendering corretto.
- [ ] **WebVTT embed in HLS** (`#EXT-X-MEDIA TYPE=SUBTITLES`):
  selezione lingua via `setPreferredTextLanguage`.
- [ ] **CEA-608 / 708** embed in MPEG-TS o HLS H.264 fMP4:
  visibili e toggle-abili.

**Feature trasversali:**
- [ ] **PiP**: ingresso da Home button + da `pipBtn` interno, ripristino,
  aspect ratio corretto, blocco doppio enter, no crash uscita.
- [ ] **MediaSession**: lock screen play/pause/skip; controllo Bluetooth
  (cuffie con multimedia keys); notifica persistente (se attiva).
- [ ] **Chromecast** (fallback Media3): toccare `MediaRouteButton` →
  device list → start cast → `castPlayer.setMediaItem` → ripristino su
  session ended.
- [ ] **Resize mode** ciclico: pulsante `resizeBtn` toggla
  FIT→FILL→ZOOM→FIT.
- [ ] **Headers HTTP** custom: passare User-Agent + Authorization,
  verificare in logcat `OkHttp`/`DefaultHttpDataSource` che siano
  applicati.
- [ ] **Speed/Rate**: `setRate(0.5/1/1.5/2)` se esposto.
- [ ] **Retry**: simulare 5xx tramite proxy; verificare che
  `useNativePlayerEngine.scheduleRetry` venga chiamato e che
  `MAX_PLAYBACK_RETRIES` sia rispettato.

**Performance:**
- [ ] Cold-start fullscreen < 1.5 s su API 30, no jank a 60 fps su TV
  box (Mi Box, Fire TV stick 4K).
- [ ] RAM a regime < 350 MB su 1 live HLS HEVC 1080p.
- [ ] Battery drain (1 h playback Wi-Fi): variazione baseline ≤ +5%.
- [ ] No regressioni rotazione (sensorLandscape lock).

#### Step 8 — Cleanup & deprecazione npm `capacitor-video-player` (0.2 g) ✅ (gate fisico residuo: gradle deps)

- [x] Verificato (`npm run check:media3`, 2026-05-16) grep ricorsivo
  `com.google.android.exoplayer2` su `android/plugins/` e `android/app/src/`
  → **zero match**.
- [ ] Verificare `./gradlew :capacitor-video-player:dependencies | grep exoplayer`
  → zero match (richiede JDK 17 completo, gate fisico).
- [x] CI guard `scripts/check-media3-migration.mjs` integrata in
  `npm run check` (script `check:media3`) → fallisce su match di
  `exoplayer2` / `MediaSessionCompat` / `MediaSessionConnector` /
  `StyledPlayerView` / `DefaultDataSourceFactory` (commenti esclusi).
- [x] `rm -rf node_modules/capacitor-video-player && npm install
  --legacy-peer-deps` → npm crea il symlink `node_modules/capacitor-video-player
  → ../android/plugins/capacitor-video-player` con `dist/plugin.cjs.js`
  + `dist/esm/index.js` esposti correttamente (verificato 2026-05-16).
  `npm ci` invece installa come copia: entrambi gli scenari sono validi
  per la build Capacitor (`cap sync` usa `dist/`).

### 4-bis.7 Criteri di accettazione

**Tecnici (oggettivi):**
- [x] Nessun riferimento residuo a `com.google.android.exoplayer2` in
  `android/plugins/` e `android/app/src/` (CI guard
  `scripts/check-media3-migration.mjs` verde 2026-05-16).
- [x] Nessun riferimento residuo a `MediaSessionConnector` o
  `MediaSessionCompat` al di fuori dei commenti (sostituiti da
  `androidx.media3.session.MediaSession`).
- [x] `androidx.media3:*` pinnato a `1.10.1` in
  `android/variables.gradle` (`media3Version`) e usato uniformemente nel
  plugin vendorato.
- [x] `services/nativeVideoPlayer.ts` **byte-per-byte** identico (la
  migrazione vive solo lato Java/XML/Gradle, l'API JS è invariata).
- [x] `npm run check` (typecheck + test:run + check:media3 + build)
  verde — 208/208 test, build Vite OK, guard OK.
- [x] Job CI guard (`npm run check:media3`) blocca regressioni
  (grep mirato su `exoplayer2`, `MediaSessionCompat`,
  `MediaSessionConnector`, `StyledPlayerView`, `DefaultDataSourceFactory`).
- [ ] **Gate fisico:** `./gradlew :app:assembleDebug` e
  `:app:assembleRelease` verdi (richiede JDK 17 completo, vedi nota P2.2).
- [ ] **Gate fisico:** APK release size delta entro **±2 MB** rispetto
  alla baseline (`apkanalyzer`).

**Funzionali (smoke matrix Step 7):**
- [ ] Tutte le celle codec/container/protocollo verdi (vedi
  §4-bis.11) — richiede device API 26+.
- [ ] Tutte le celle sottotitoli verdi.
- [ ] Tutte le celle feature trasversali verdi.
- [ ] Performance: nessuna metrica peggiore di -5% rispetto baseline.

**Documentali:**
- [x] `AGENTS.md` aggiornato: "Mobile Runtime: Capacitor 7 +
  AndroidX Media3 1.10.1".
- [x] `.github/copilot-instructions.md` aggiornato (idem + nota
  vendor in §"Important Gotchas").
- [x] `README.md` aggiornato (stack runtime Android).
- [x] `android/plugins/capacitor-video-player/README.md` creato con
  rationale fork + lista patch + versioni pinnate.

### 4-bis.8 Rischi e mitigazioni

| Rischio | Probabilità | Impatto | Mitigazione |
| ------- | ----------- | ------- | ----------- |
| `MediaSessionConnector` → `MediaSession` introduce bug sui controlli BT/lock screen | Media | Medio | Step 7 smoke dedicato; in caso di problemi, MediaSession minimal con solo `play/pause/seek` |
| `@UnstableApi` warning a tappeto bloccano CI lint | Alta | Basso | Opt-in mirato a livello classe (`@UnstableApi` su `FullscreenExoPlayerFragment`); evitare opt-in globale per non perdere segnale |
| `DefaultDataSourceFactory` ridenominato → compilazione spezzata residua | Media | Basso | Sostituzione manuale nello Step 2; grep esplicito post-sed |
| Layout XML attributi cambiati silenziosamente in Media3 | Bassa | Medio | Verifica visiva nello smoke Step 7 + screenshot diff con baseline |
| Cast Media3 richiede `play-services-cast-framework` ≥ 21.4 → conflitti con altri plugin Capacitor | Bassa | Medio | Pinning unico in `variables.gradle`, verifica `./gradlew :app:dependencies` |
| **HEVC/HDR funzionano "per accidente" su Exo 2** → regressione fix dopo migrazione | Bassa | Alto | `setEnableDecoderFallback(true)` + smoke HEVC su almeno 2 device OEM diversi (es. Mi Box, Samsung tablet) |
| **AV1 SW assente** → device senza decoder HW falliscono in silenzio | Bassa | Medio | Errore esplicito tramite `Player.Listener.onPlayerError(PlaybackException)` + classificazione `category: 'codec'` lato JS; opzione `media3-decoder-av1` da abilitare se incidenza > 5% |
| **AC-3 / E-AC-3 / AC-4 passthrough** non funziona su TV box | Bassa | Medio | Verificare `AudioCapabilities` runtime + log; mantenere fallback PCM downmix automatico (default Media3) |
| **MKV/Matroska** non rilevato dal detection JS | Media | Basso | Estendere `playerUtils.detectStreamSource` per `.mkv` → engine `native` su Android (passa al plugin) |
| **CEA-608/708 closed captions** non visualizzate dopo migrazione | Bassa | Basso | `PlayerView.setShowSubtitleButton(true)` + verifica `Tracks.Group` con `C.TRACK_TYPE_TEXT` |
| `capacitor-video-player` upstream pubblica una versione Media3 dopo il nostro fork | Bassa | Basso | Documentare il fork in `android/plugins/capacitor-video-player/README.md`; possibile re-merge futuro tramite cherry-pick |
| Bump Media3 minor (`1.10` → `1.11`) introduce breaking change ai listener | Media | Basso | Pin esplicito `1.10.x`, bump minor solo con nuova smoke matrix |

### 4-bis.9 Stima totale

| Step | Descrizione | Stima |
| ---- | ----------- | ----- |
| 0 | Decisione strategia + vendor plugin | 0.3 g |
| 0-bis | Snapshot funzionale baseline | 0.3 g |
| 1 | Bump dipendenze Gradle | 0.2 g |
| 2 | Porting import Java + XML | 1.0 g |
| 3 | Riscrittura MediaSession (breaking) | 1.0 g |
| 3-bis | Codec/renderer fallback + buffer tuning | 0.5 g |
| 3-ter | Container & sottotitoli (parità + MKV bonus) | 0.3 g |
| 4 | Cast extension Media3 | 0.5 g |
| 5 | PiP, layout, attributi UI | 0.3 g |
| 6 | ProGuard / R8 / opt-in | 0.2 g |
| 7 | Smoke matrix Android (gate fisico) | 0.7 g |
| 8 | Cleanup + deprecazione npm | 0.2 g |
| | **Totale dev** | **~5.5 g** |
| | **+ verifica fisica device** | **~0.7 g** |

### 4-bis.10 Aggiornamenti documentali richiesti dopo merge

- **`.github/copilot-instructions.md`:**
  - Cambiare "Native Android player using **ExoPlayer**" →
    "Native Android player using **AndroidX Media3 1.10.1**
    (`androidx.media3:media3-exoplayer:1.10.1`)".
  - Aggiungere a "Important Gotchas":
    > "**Android player plugin (vendor):** `capacitor-video-player` è
    > vendorato in `android/plugins/capacitor-video-player/` per
    > scollegarsi dall'upstream orfano. Patch e bump Media3 vanno fatti
    > lì; `node_modules/capacitor-video-player` non esiste più come
    > pacchetto GitHub."
- **`AGENTS.md`:**
  - In "Tech Stack → Mobile Runtime": stessa nota.
  - Nella sezione "Player Android": aggiungere riferimento a
    `androidx.media3.session.MediaSession`, `androidx.media3.cast.CastPlayer`,
    `DefaultRenderersFactory.setEnableDecoderFallback(true)`.
- **`README.md`:**
  - Sezione "Tech Stack": "Native Android player: AndroidX Media3 1.10.1".
  - Verificare che minSdk consigliato resti 24 (Media3 1.10 richiede
    minSdk 21+ → OK, nessun bump richiesto).
- **`docs/IMPROVEMENT_PLAN.md`** (questo documento):
  - Spuntare le checkbox di MED-1 in §1 e §5 P2.4.
  - Aggiornare hotspot complessità in §1 se cambia il count del plugin
    vendorato.

### 4-bis.11 Matrice codec/protocolli/sottotitoli (before → after)

Tabella di **parità funzionale completa**. Ogni riga deve passare
nello smoke Step 7. Indica il **comportamento atteso post-migrazione**.

#### Codec video

| Codec | Profilo | Container | Exo 2.19 | Media3 1.10.1 | Note |
| ----- | ------- | --------- | -------- | ------------- | ---- |
| H.264/AVC | Baseline/Main/High | MP4, MKV, TS, HLS, DASH | ✅ HW | ✅ HW | Decoder OEM, fallback OMX |
| H.265/HEVC | Main, Main10 | MP4, MKV, TS, HLS, DASH | ✅ HW | ✅ HW + fallback | `setEnableDecoderFallback(true)` |
| HDR10 / HDR10+ | — | HEVC/AV1 | ⚠ best-effort | ✅ con `Format.colorInfo` | Tunneling abilitato |
| Dolby Vision | Profile 5/7/8 | MP4/HEVC | ⚠ device-dependent | ✅ device-dependent | Nessun degrado |
| VP8 | — | WebM, MKV | ✅ | ✅ | Stack OEM |
| VP9 | Profile 0, Profile 2 (HDR) | WebM, MKV, DASH | ✅ | ✅ | |
| AV1 | Main | MP4, MKV, WebM, DASH | ✅ HW (API 31+) | ✅ HW + opzionale SW `media3-decoder-av1` | Fallback graceful |
| MPEG-2 Video | — | TS, MP4 | ✅ | ✅ | DVB legacy |
| MPEG-4 Part 2 | — | MP4, 3GP, AVI | ✅ | ✅ | File legacy |
| H.263 | — | 3GP | ✅ | ✅ | Legacy mobile |

#### Codec audio

| Codec | Profilo | Container | Exo 2.19 | Media3 1.10.1 | Note |
| ----- | ------- | --------- | -------- | ------------- | ---- |
| AAC | LC, HE, HEv2, ELD | MP4, MKV, TS, HLS, DASH, ADTS | ✅ | ✅ | Default IPTV |
| MP3 | — | MP3, MP4, MKV | ✅ | ✅ | Radio streams |
| Vorbis | — | OGG, WebM, MKV | ✅ | ✅ | |
| Opus | — | OGG, WebM, MKV | ✅ | ✅ | |
| FLAC | — | FLAC, MKV, MP4 | ✅ | ✅ | Lossless |
| AC-3 (Dolby Digital) | — | MP4, MKV, TS | ✅ passthrough | ✅ passthrough + PCM downmix | `AudioCapabilities` runtime |
| E-AC-3 (DD+) | — | MP4, MKV, TS, DASH | ✅ passthrough | ✅ passthrough + PCM downmix | |
| AC-4 (Atmos) | — | MP4, DASH | ✅ device-dependent | ✅ device-dependent | Nessun degrado |
| DTS / DTS-HD / DTS-Express | — | MKV, TS | ⚠ passthrough only | ⚠ passthrough only | Nessun decoder SW (limite Android) |
| PCM | — | WAV, MP4, MKV | ✅ | ✅ | |
| AMR-NB / AMR-WB | — | 3GP, AMR | ✅ | ✅ | Legacy voice |

#### Container & protocolli

| Container/Protocollo | Estensioni | Exo 2.19 | Media3 1.10.1 | Engine MediaSource |
| -------------------- | ---------- | -------- | ------------- | ------------------- |
| MP4 / MOV / M4V | `.mp4`, `.m4v`, `.mov` | ✅ | ✅ | `ProgressiveMediaSource` (`Mp4Extractor`) |
| Matroska / WebM | `.mkv`, `.webm` | ✅ (via extractor default) | ✅ | `ProgressiveMediaSource` (`MatroskaExtractor`) — **da aggiungere a `supportedFormat`** |
| OGG / OGV | `.ogv`, `.ogg` | ✅ | ✅ | `ProgressiveMediaSource` (`OggExtractor`) |
| 3GP | `.3gp` | ✅ | ✅ | `ProgressiveMediaSource` (`Mp4Extractor`) |
| FLV | `.flv` | ✅ | ✅ | `ProgressiveMediaSource` (`FlvExtractor`) |
| MPEG-TS (progressive) | `.ts`, `.mpeg`, `.mpg` | ✅ | ✅ | `ProgressiveMediaSource` (`TsExtractor`) |
| HLS | `.m3u8` | ✅ | ✅ + `setAllowChunklessPreparation(true)` | `HlsMediaSource` |
| DASH | `.mpd` | ✅ | ✅ | `DashMediaSource` |
| SmoothStreaming | `.ism`, `.isml` | ✅ | ✅ | `SsMediaSource` |
| MP3 | `.mp3` | ✅ | ✅ | `ProgressiveMediaSource` (`Mp3Extractor`) |
| FLAC | `.flac` | ✅ | ✅ | `ProgressiveMediaSource` (`FlacExtractor`) |
| WAV | `.wav` | ✅ | ✅ | `ProgressiveMediaSource` (`WavExtractor`) |
| ADTS / AAC | `.aac` | ✅ | ✅ | `ProgressiveMediaSource` (`AdtsExtractor`) |

#### Sottotitoli

| Formato | Estensione | MIME | Sideload | HLS embed | DASH embed | Note |
| ------- | ---------- | ---- | -------- | --------- | ---------- | ---- |
| WebVTT | `.vtt` | `MimeTypes.TEXT_VTT` | ✅ | ✅ | ✅ | Standard HLS/DASH |
| SubRip | `.srt` | `MimeTypes.APPLICATION_SUBRIP` | ✅ | n/a | n/a | Sideload only |
| SSA/ASS | `.ssa`, `.ass` | `MimeTypes.TEXT_SSA` | ✅ | n/a | n/a | Styling parziale |
| TTML | `.ttml`, `.dfxp`, `.xml` | `MimeTypes.APPLICATION_TTML` | ✅ | ✅ | ✅ | EBU-TT supportato |
| CEA-608 | embed | `MimeTypes.APPLICATION_CEA608` | n/a | ✅ | n/a | Closed captions analogiche |
| CEA-708 | embed | `MimeTypes.APPLICATION_CEA708` | n/a | ✅ | n/a | Closed captions digitali |
| PGS (Bluray) | embed | `MimeTypes.APPLICATION_PGS` | n/a | n/a | n/a | Solo MKV → graceful skip |
| DVB Subtitle | embed | `MimeTypes.APPLICATION_DVBSUBS` | n/a | n/a | n/a | Solo TS → graceful skip |

#### Feature trasversali (must-preserve)

| Feature | Implementazione attuale | Media3 1.10.1 | Note |
| ------- | ----------------------- | ------------- | ---- |
| Picture-in-Picture | `PictureInPictureParams.Builder` + `Rational(width, height)` da `player.getVideoFormat()` | ✅ invariato | Android API, non Media3 |
| MediaSession lock screen | `MediaSessionCompat` + `MediaSessionConnector` | ✅ `androidx.media3.session.MediaSession` | Auto-bind al Player |
| Bluetooth media keys | via MediaSessionConnector | ✅ via MediaSession | |
| Chromecast | `CastContext` + `CastPlayer` + `MediaRouteButton` | ✅ `androidx.media3.cast.CastPlayer` | API 1:1 |
| HTTP headers custom | `DefaultHttpDataSource.Factory.setDefaultRequestProperties` | ✅ invariato | |
| Resize mode (FIT/FILL/ZOOM) | `AspectRatioFrameLayout.RESIZE_MODE_*` | ✅ invariato | `PlayerView.setResizeMode(...)` |
| Caption styling | `CaptionStyleCompat` (foreground/background/font size) | ✅ invariato | |
| Autoplay / Loop / Poster | parametri plugin | ✅ invariato | |
| Live edge / TTFF | HLS `setAllowChunklessPreparation` (NEW) | ✅ migliorato | -300ms tipici |
| Seek (preview / fastSeek) | `player.seekTo(positionMs)` | ✅ invariato | |
| Volume / Mute / Rate | `player.setVolume(f)` / `setPlaybackParameters` | ✅ invariato | |
| Buffer tuning IPTV | default ExoPlayer 2 | ✅ esplicito tramite `DefaultLoadControl.Builder` | minBuffer 15s/maxBuffer 50s |
| Retry esponenziale (lato JS) | `useNativePlayerEngine.scheduleRetry` + `classifyPlaybackError` | ✅ invariato | Solo lato JS, plugin pubblica `jeepCapVideoPlayerError` |
| OSD overlay (lato JS) | `usePlayerOsd` | ✅ invariato | Indipendente dal plugin nativo |
| Auto-next episodio | `useAutoNextEpisode` | ✅ invariato | Lato JS |
| Sleep timer | `useSleepTimer` | ✅ invariato | Lato JS |
| MediaRouter button (UI cast) | `androidx.mediarouter:mediarouter:1.7.0` | ✅ invariato | AndroidX, non Media3 |
| Subtitle View | `SubtitleView` di `PlayerView` (Media3) | ✅ invariato | Auto-styled via `CaptionStyleCompat` |

---

## 📦 4-ter. PKG-1: Pipeline Linux release multi-distro firmata

> **Priorità: P1 — distribuzione production.** Aggiunto 2026-05-18 come
> retrospettiva consolidata. Stato: ✅ **completato e in produzione**.
> Storia completa delle iterazioni in
> [`docs/plan-linuxDistroPackaging.prompt.md`](plan-linuxDistroPackaging.prompt.md).

### 4-ter.1 Obiettivi raggiunti

- ✅ **6 pacchetti nativi per-distro** in un'unica run CI:
  `opensuse | fedora | rhel | debian | ubuntu | arch`. Dipendenze rese
  con il package-name nativo di ogni distro (`build/depends/<distro>.json`),
  niente SONAME generici per zypper/dnf/apt.
- ✅ **Firma headless GPG** con maintainer Ed25519 + subkey
  (`14CAF4E8751A96FE`):
  - `.deb` → `debsigs --sign=origin` (membro `_gpgorigin`).
    Ubuntu 24.04 noble ha rimosso `dpkg-sig`.
  - `.rpm` → `rpm --addsign` con macro `%__gpg_sign_cmd` SHA-256.
  - `.pkg.tar.zst` → `gpg --detach-sign` (`.sig` binario).
  - Aggregato `SHA256SUMS{,.asc}`.
- ✅ **Verifica strict in CI** (`set -euo pipefail`, no `|| true`):
  - RPM: pubkey importata in **rpmdb dedicato** via `rpm --dbpath`
    + `--initdb` + `--import`; `sudo rpm --import` scriveva la chiave
    nella rpmdb di root, invisibile al runner user.
  - DEB: blob firmato ricostruito **nell'ordine reale di `ar t`**
    (control/data compression può variare l'ordine), `gpg --verify`
    contro `_gpgorigin`/`_gpgbuilder`.
  - Cross-check: almeno un artefatto per ognuna delle 6 distro attese,
    glob underscore-separated `*_${distro}_*`.
- ✅ **SLSA build provenance** (`actions/attest-build-provenance@v2`)
  emessa per ogni asset.
- ✅ **GPG agent passphrase pre-cache** (`scripts/import-gpg-key.sh`):
  `allow-preset-passphrase` in `gpg-agent.conf` + `gpg-preset-passphrase`
  per ogni keygrip (primary + subkeys). Né `debsigs`, né `rpm --addsign`,
  né `gpg --detach-sign` toccano `/dev/tty`.
- ✅ **GitHub Pages via Pages API** (`actions/configure-pages@v5` +
  `upload-pages-artifact@v3` + `deploy-pages@v4`, environment
  `github-pages`). Sostituisce il vecchio push su `gh-pages` che
  falliva con HTTP 500 una volta cresciuto il pack.
- ✅ **Retention pacchetti storici via cache + Release fallback:**
  primary `actions/cache` keyed `pages-history-v1-*`; eviction fallback
  con `gh release download` di tutti i `.deb`/`.rpm`/`.pkg.tar.zst`/`.sig`/`.asc`
  pubblicati nelle Release passate (storage permanente). `publish-repo.sh`
  ricostruisce metadati `reprepro`/`createrepo_c`/`repo-add` sull'unione
  vecchi+nuovi.
- ✅ **NVRA dedup nuke-and-rebuild** (commit `bc8ce99`): re-build dello
  stesso semver con bytes diversi (timestamp embed) non genera più
  conflitti `reprepro: md5 expected ... got ...`; lo stato `db/packages.db`
  viene ricreato da zero a ogni run.
- ✅ **Caching 4-layer** (cold ~14 min → warm ~5 min):
  `~/.cache/electron`, `~/.cache/electron-builder`, APT toolchain
  (`awalsh128/cache-apt-pkgs-action`), Docker images
  `electronuserland/builder` + `archlinux:latest` (`ScribeMD/docker-cache`).
- ✅ **Versioning centralizzato (`/.version` → `sync-version.mjs`)**:
  CI esporta `COMMIT_SHA=${GITHUB_SHA::7}` e `build-linux.sh` lo passa
  a `make-distro-config.mjs --commit`, embeddato nel nome:
  `streamai-iptv_${ver}_${sha7}_${distro}_${arch}.${ext}` (CI),
  `streamai-iptv_${ver}_${distro}_${arch}.${ext}` (locale).

### 4-ter.2 Comandi utili

```bash
npm run dist:linux                    # auto-detect host via /etc/os-release
npm run dist:linux:{opensuse,fedora,rhel,debian,ubuntu,arch}
npm run gpg:setup                     # one-time: Ed25519 + AES-256 backup
npm run gpg:upload                    # carica i 3 secret via gh CLI
npm run repo:publish                  # assembla public-repo/ in locale
npm run version:sync                  # propaga /.version
npm run version:full                  # stampa base[_<sha7>]
```

Tag `v*` push → `.github/workflows/linux-release.yml` esegue tutto.

### 4-ter.3 Gotchas operativi (vedi anche `copilot-instructions.md` §10-13)

1. **Settings → Pages → Source: "GitHub Actions"** (non "Deploy from a
   branch"). Mai reintrodurre push su `gh-pages`.
2. **`dpkg-sig` non più disponibile** in Ubuntu 24.04 — usare `debsigs`.
3. **`directories.output`** in `package.json` non deve essere
   sovrascritto (vedi commit `4127c37`): Vite usa `dist/renderer` +
   `dist/main`, electron-builder usa `dist/*.{deb,rpm}`. Senza
   collisioni, ma se lo override va a `release/`, `sign-linux-packages.sh`
   firmava un manifest stdin-derived vuoto (mascherava il bug).
4. **Plugin Capacitor vendorato:** `dist/` del plugin va committato
   (commit `736be6e`) perché Vite/Rollup resolver lo richiede al
   `npm ci`. Eccezione mirata in `.gitignore`.

### 4-ter.4 Lavoro residuo (opzionale)

- [ ] **AppImage / tar.xz** in CI: oggi sono buildabili in locale
  (`npm run dist:linux:appimage` / `:tar`) ma il workflow CI li ha
  esclusi (commit `be8bfc5`). Riabilitare se serve un canale portable.
- [ ] **Notarization Windows + .dmg macOS** — fuori scope corrente
  (oggi solo Linux). Se aperto, allineare struttura `build/depends/`.
- [x] **Job typecheck/test/build su PR** (G.4): `.github/workflows/ci.yml`
  attivo su `push` + `pull_request` esegue `npm run check` completo
  (deps + typecheck + 209 vitest + media3 + wails + go vet/build +
  vite build) + `go test ./internal/...`. Chiude TEST-1 §2-bis come
  gate stabile contro regressioni future. **Closed 2026-05-22.**

---

## ♻️ 4-quater. REF-1: Re-split hotspot post-feature creep

> **Priorità: P2 — manutenibilità.** Aggiunto 2026-05-18.
> Dalle metriche §1: B.1 ha perso il 64% del beneficio iniziale, e nuovi
> componenti sono cresciuti oltre soglia. Senza intervento, la prossima
> tranche player + onboarding renderà ancora più costoso ogni refactor
> e rallenterà la review delle PR.

### 4-quater.1 Diagnosi quantitativa

| File | Δ dall'ultimo split | Cause principali |
| ---- | ------------------: | ---------------- |
| `components/VideoPlayerNew.tsx` | **+626** (973 → 1.599) | Error report copy + `buildErrorReport()` ~100 righe; OSD feedback aggiuntivi; bridge native retry; subtitle sideload UI; diagnostica pannello |
| `App.tsx` | +228 (923 → 1.151) | `AiUnavailableHint`, refresh BG Xtream, font scale orchestration, M3U async pipeline, onboarding cheatsheet trigger |
| `components/ChannelList.tsx` | +132 (834 → 966) | Continue Watching per-tipo + carosello filtrato, banner health-aware, filtri avanzati Cmd+K |
| `components/ProfileSettings.tsx` | +287 (651 → 938) | Toggle CW per-tipo, font scale select, onboarding re-trigger, health badge sezione, hide-AI-hint pref |

### 4-quater.2 Refactor proposto (4 sotto-tranche)

#### REF-1.a — Re-split `VideoPlayerNew.tsx` (target ≤ 1.000 righe)

- [ ] Estrarre `components/player/ErrorReport.tsx` (overlay errore +
  `buildErrorReport()` + `copyErrorReport()` con clipboard fallback).
- [ ] Estrarre `components/player/PlayerSubtitleSideloader.tsx` (file
  picker + parse SRT/VTT + track injection, oggi inline).
- [ ] Hook `usePlayerErrorRing()` (ring buffer ultimi 10 errori) in
  `hooks/` — condiviso con `StreamDiagnostics`.
- [ ] Hook `usePlayerRetryPolicy()` (classify + exponential backoff,
  oggi inline duplicato lato JS).
- [ ] Test smoke: tutti gli OSD e shortcut (`P/Space`, `←/→`, `↑/↓`,
  `M`, `F`, `C`, `L`, `S`, `T`, `G`, `Esc`) restano funzionanti dopo
  lo split.

#### REF-1.b — Decomporre `App.tsx` (target ≤ 800 righe)

- [ ] Estrarre `components/AiUnavailableHint.tsx` (oggi inline ~80
  righe, gestione dual-layer `sessionDismissed` + `hideAiUnavailableHint`).
- [ ] Estrarre `hooks/useFontScale.ts` (mapping `'sm|md|lg|xl'` →
  `<html>{font-size}`, oggi `useEffect` in `App.tsx`).
- [ ] Estrarre `hooks/useXtreamRefreshOrchestrator.ts` (lock + offline
  guard + timestamp ultimo refresh).
- [ ] Estrarre `hooks/useM3uPlaylistLoader.ts` (worker dispatch + parse
  + storage, vedi gotcha §8 copilot-instructions).

#### REF-1.c — Splittare `ProfileSettings.tsx` in tab (target ≤ 600 righe)

- [ ] Architettura `components/profileSettings/`:
  - `TabAppearance.tsx` (tema OLED + font scale + design system preview).
  - `TabPlayback.tsx` (CW threshold, CW per-tipo, auto-next, sleep
    timer default, cheatsheet re-trigger).
  - `TabCatalog.tsx` (refresh BG, health badge, sync timestamps,
    hide-AI-hint).
  - `TabAdvanced.tsx` (cache stats, clear cache, diagnostics export).
- [ ] Bottom-nav o pill-tabs (DS-v1 `Chip` row).

#### REF-1.d — Snellire `ChannelList.tsx` (target ≤ 750 righe)

- [ ] Estrarre `components/channelList/ContinueWatchingRail.tsx`
  (carosello dedicato + filtri per-tipo + progress overlay).
- [ ] Estrarre `components/channelList/CatalogToolbar.tsx`
  (search + chip filtri tipo + filtri avanzati HD/Nuovi/Genere).
- [ ] Mantenere virtualizzazione + grid logic nel componente principale.

### 4-quater.3 Criteri di accettazione

- [ ] Tutti i 4 file sopra la soglia tornano sotto il target.
- [ ] Tabella hotspot §1 aggiornata (no file > 1.000 righe).
- [ ] **Test suite (post TEST-1)** verde 207/207 + eventuali nuovi
  test sui sotto-componenti estratti (target +6 test).
- [ ] Nessuna regressione su shortcut player, accessibility, focus.
- [ ] `npm run build` bundle iniziale invariato (target < 250 kB gzip;
  oggi 146).

### 4-quater.4 Stima

| Sotto-tranche | Stima | Priorità |
| ------------- | -----:| -------- |
| REF-1.a `VideoPlayerNew` | 1.5 g | P1 (debt produttivo) |
| REF-1.b `App.tsx` | 1.0 g | P2 |
| REF-1.c `ProfileSettings` | 1.0 g | P2 |
| REF-1.d `ChannelList` | 0.7 g | P2 |
| | **~4.2 g** | |

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

#### P2.4 Migrazione ExoPlayer 2 → AndroidX Media3 🚧 codice pronto (dettaglio in §4-bis MED-1)

- [x] Vendor del plugin `capacitor-video-player` in
  `android/plugins/capacitor-video-player/`.
- [x] Upgrade dipendenze da `com.google.android.exoplayer:*:2.19.0` →
  `androidx.media3:media3-*:1.10.1` (pin 2026-05-15, fallback minimo `1.4.1`).
- [ ] **Snapshot funzionale baseline** (codec usati, TTFF, screenshot
  resize, lock screen) per regression test (§4-bis.6 Step 0-bis) —
  richiede device fisico.
- [x] Porting Java + XML layout (mapping in §4-bis.4 + script sed §4-bis.6 Step 2).
- [x] Riscrittura `MediaSessionConnector` → `androidx.media3.session.MediaSession`.
- [x] **`DefaultRenderersFactory.setEnableDecoderFallback(true)`** +
  `setExtensionRendererMode(PREFER)` per garantire fallback codec
  HEVC/AV1 su OEM con decoder buggy.
- [x] **`DefaultTrackSelector`** con `setTunnelingEnabled(true)` per
  HDR/4K + multi-lingua audio/text (`setPreferredAudioLanguage`,
  `setPreferredTextLanguage`, `setSelectUndeterminedTextLanguage(true)`).
- [x] **`HlsMediaSource.Factory.setAllowChunklessPreparation(true)`**
  per ridurre TTFF di ~300 ms su provider Xtream.
- [x] **`DefaultLoadControl.Builder`** con buffer IPTV-friendly
  (min 15 s / max 50 s / playback 1.5 s / rebuffer 5 s) +
  `setPrioritizeTimeOverSizeThresholds(true)`.
- [x] Estensione `supportedFormat` con `mkv`/`matroska` già applicata
  nel plugin vendorato (`FullscreenExoPlayerFragment.java:137` + branch
  `buildHttpMediaSource()` linee 972-973 → `ProgressiveMediaSource` via
  `MatroskaExtractor` di default in Media3).
- [x] Cast extension Media3 (`androidx.media3.cast.CastPlayer`, API 1:1).
- [x] ProGuard rules per `androidx.media3.*` + `com.google.android.gms.cast.*`
  + `com.jeep.plugin.capacitor.capacitorvideoplayer.*`.
- [ ] **Smoke matrix completa** (§4-bis.11) device fisico:
  - 10 codec **video** (H.264, HEVC + HDR10+/Dolby Vision, VP8/9 HDR,
    AV1, MPEG-2, MPEG-4 Part 2, H.263).
  - 11 codec **audio** (AAC LC/HE/HEv2/ELD, MP3, Vorbis, Opus, FLAC,
    AC-3, E-AC-3 passthrough, AC-4 Atmos, PCM, AMR-NB/WB).
  - 13 container/protocolli (MP4, MKV, WebM, OGG, 3GP, FLV, TS, HLS,
    DASH, SmoothStreaming, MP3, FLAC, WAV).
  - 8 formati sottotitoli (VTT, SRT, SSA/ASS, TTML/DFXP, CEA-608/708
    embed, HLS WebVTT embed).
  - Feature trasversali (PiP + Rational aspect, MediaSession lock
    screen + BT, Cast, HTTP headers, resize FIT/FILL/ZOOM, retry,
    caption styling).
- [x] **CI guard** `scripts/check-media3-migration.mjs` integrata in
  `npm run check` — fallisce se `grep -r "com\.google\.android\.exoplayer2"
  android/plugins/ android/app/src/` (skip commenti) trova match.
- [x] Aggiornati `AGENTS.md`, `copilot-instructions.md`, `README.md` +
  creato `android/plugins/capacitor-video-player/README.md`.

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
- [x] **Modalità landscape immersiva forzata (2026-05-15):**
  `AndroidManifest.xml` con `screenOrientation="sensorLandscape"` (lock
  landscape, flip 180° permesso per tablet/TV). `MainActivity.java` chiama
  `enableImmersiveMode()` (AndroidX `WindowCompat.setDecorFitsSystemWindows(false)`
  + `WindowInsetsControllerCompat.hide(systemBars())` con behavior
  `BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE`) in `onCreate`, `onWindowFocusChanged`
  e all'uscita da PiP. `styles.xml` configura il tema con
  `windowFullscreen=true`, `windowLayoutInDisplayCutoutMode=shortEdges`
  (contenuto sotto il notch sui lati corti) e status/navigation bar
  trasparenti. Il launch theme (splash) eredita gli stessi flag per
  evitare salti visivi alla transizione post-splash.
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

#### P7.1 Test automatici ❌ regressione (TEST-1)

- [x] `vitest` + `jsdom` installati. Script `test`, `test:run`, `check`.
- [x] Test moduli puri: `codecParser` (13), `hlsParser` (5), `mpegtsProbe`
  (13), `playerUtils` (15), `scrubbing.test.tsx` (5), `vodProbe` (6),
  `xmltvParser` (11), `reminderService` (5), `subtitleService` (11),
  `gzipUtil` (5), `useBackStack` (6), `ui/tokens` (53), `ui/shared` (19),
  `xtream/loginXtream` (15, BUG-1 §2.3 Step 5), `workers/workers` (7, E.3),
  `catalog/catalogIndex` (6, C.3 filtri avanzati),
  `onboarding/wizard` (4), `onboarding/cheatsheet` (5),
  `ui/a11y-fontScale` (3). **Totale atteso: 207 test in 19 file.**
- [ ] **❌ Suite rotta (2026-05-18):** 6 file vanno in *Failed Suites* per
  `Cannot find module '@testing-library/dom'`. Stato attuale **167
  passati su 207**. Fix in §2-bis (peer dep mancante, 1 riga).
- [ ] `@testing-library/react` snapshot UI critici (`ChannelList`, `ProfileSelection`).
- [ ] Test parser M3U, ProfileService, CacheService, i18n shape, Xtream URL helper.
- [ ] Mock test discovery/cast service.
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

### C.1 Discoverability scorciatoie ✅

- [x] Overlay `?` / `Shift+/` cheatsheet completa.
- [x] Tooltip su pulsanti player con scorciatoia (`F`, `M`, `P`, ...).
- [x] **Onboarding al primo avvio profilo (2026-05-15):** `App.tsx` apre
  automaticamente `ShortcutsCheatsheet` 600 ms dopo l'attivazione del
  profilo se `ProfilePreferences.hasSeenShortcutsCheatsheet !== true`.
  L'overlay in modalità onboarding mostra una checkbox "Non mostrare più
  al prossimo avvio" e una CTA "Ho capito"; alla chiusura, il flag viene
  comunque marcato `true` (anche senza spunta, perché l'utente l'ha già
  vista una volta). L'apertura manuale via `?` / `Shift+/` NON mostra la
  checkbox. Toggle "Mostra scorciatoie al primo avvio" in
  `ProfileSettings → Riproduzione` per riattivare l'onboarding al
  prossimo accesso. Tests `tests/onboarding/cheatsheet.test.tsx` (5).

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

### C.6 Accessibilità ✅ (2026-05-15)

- [x] `aria-label` su `IconButton` (DS).
- [x] Focus ring contrastato outside (UI-1.4).
- [x] `prefers-reduced-motion` rispettato (UI-1.4).
- [x] **Modalità daltonici (2026-05-15):** i `Badge` HD/Match%/anno in
  `MovieDetail.tsx` e `SeriesDetail.tsx` ora includono un'icona Lucide
  (`Tv` per HD, `CheckCircle2` per Match%, `Calendar` per l'anno). Il
  significato non dipende più dal solo colore — utile per utenti
  daltonici e per screen reader (icone esposte con `aria-hidden` ma il
  testo del badge resta accessibile).
- [x] **Font size selezionabile S/M/L/XL (2026-05-15):**
  `ProfilePreferences.fontScale` (`'sm' | 'md' | 'lg' | 'xl'`, default
  `'md'`). Mappato a `<html> { font-size: 14|16|18|20 px }` da `App.tsx`:
  poiché tutte le size Tailwind sono in `rem`, l'intera UI scala in
  proporzione (testi, padding, wrapper icone). Selettore in
  `ProfileSettings → Aspetto → Dimensione testo`. Tests
  `tests/ui/a11y-fontScale.test.tsx` (3): default `md`, riflesso del
  valore profilo nel select, persistenza dello state locale al change.
- [x] **Audit aria-label icon-only (2026-05-15):** verificato con grep
  ricorsivo (`<button>` con icona Lucide come unico figlio): tutti i
  bottoni icon-only in `components/` o usano il wrapper DS `IconButton`
  (che impone `aria-label`) oppure dichiarano esplicitamente `aria-label`
  + `title` (vedi `VideoPlayerNew.tsx`). Nessuna regressione trovata.

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

### G.1 Test automatici ❌ regressione TEST-1 (vedi P7.1 + §2-bis)

Attesi 207 test in 19 file. Stato 2026-05-18: **167 passati, 40 bloccati
da `@testing-library/dom` mancante**. Fix in §2-bis (P0).
Dopo il fix: mancano UI snapshot, parser M3U, ProfileService, CacheService,
i18n shape, discovery/cast mock.

### G.2 ESLint + Prettier + Husky ⏳

- [ ] ESLint 9 flat + React/Hooks/TypeScript + `jsx-a11y`.
- [ ] Prettier con `tailwindcss/prettier-plugin`.
- [ ] Husky + lint-staged → blocca push con errori.

### G.3 Allineamento documentale 🚧

- [x] `copilot-instructions.md` e `AGENTS.md` aggiornati a React 19.
- [ ] Allineare AGENTS.md con i nuovi moduli `services/streamInfo/`.
- [ ] Generare API doc dei service singleton con TypeDoc.

### G.4 CI GitHub Actions 🚧 (1 job su 2 attivo)

- [x] **`linux-release.yml`** (PKG-1, §4-ter): tag `v*` → 6 pacchetti
  firmati + SLSA + GitHub Pages. Cold ~14 min, warm ~5 min.
- [ ] **`ci.yml`** (NUOVO, P0 dopo TEST-1): su `push` + `pull_request`
  eseguire `npm ci && npm run typecheck && npm run test:run &&
  npm run check:media3 && npm run build`. Senza, una regressione come
  TEST-1 può restare invisibile fino al prossimo tag.
- [ ] `android.yml`: build APK debug su PR (artefatto). Bloccato finché
  manca matrix con JDK 17 completo + emulatore (vedi MED-1 gate fisico).

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

### Sprint 0 (urgente, ~2-3 giorni) — BUG-1 Films + URG-1 + TEST-1

- [x] **BUG-1 §2.3 Step 1-5** (~1.7 g): cache hardening, retry mirato,
  feedback UI, test unitari. ✅ 2026-05-14 (15/15 test).
- [x] **TEST-1 §2-bis (P0, ½ g):** ✅ 2026-05-20 — aggiunte
  `@testing-library/dom` + `@testing-library/jest-dom` a
  `devDependencies`; suite a **209/209 verdi**; aggiunto
  `scripts/check-deps.mjs` cablato in `npm run check` come `check:deps`
  per intercettare future regressioni peer-dep.
- [x] URG-1 Livello 1-3 (✅ 2026-05-13).
- [ ] URG-1 Livello 4 opzionale (Range proxy Electron).
- [ ] Smoke su 3 provider reali (mp4 faststart, non-faststart, MKV).

### Sprint 0.5 — UI-1 DS v1 ✅ completato 2026-05-14

### Sprint 0.6 — PKG-1 Linux release pipeline ✅ completato 2026-05-18

Vedi §4-ter. Gate residuo: aggiungere job CI `ci.yml` su push/PR
(typecheck + test + build) per non dipendere solo dai tag `v*`.

### Sprint 0.7 — REF-1 Re-split hotspot (~4.2 g, P1+P2)

Vedi §4-quater. Da pianificare nelle settimane 9-10 in parallelo con E.1/E.7,
oppure subito dopo TEST-1 se la velocity lo consente.

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
- **MED-1 Migrazione ExoPlayer → AndroidX Media3 1.10.1** (§4-bis, ~5.5 g
  dev + 0.7 g verifica fisica device). Si inserisce qui perché tocca
  solo Android e trae giovamento dalle ottimizzazioni E.8. La smoke
  matrix copre **10 codec video + 11 codec audio + 13 container +
  8 formati sub** per parità funzionale completa.

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
- [ ] `npm run test:run` OK (209/209 al 2026-05-20 dopo TEST-1 §2-bis).
- [ ] `npm run check` OK (include `check:deps` + `check:media3` + build).
- [ ] `npm run build` OK.
- [ ] Smoke Electron OK se tocca runtime desktop.
- [ ] Android sync/build OK se tocca mobile.
- [ ] Se tocca packaging Linux: smoke `npm run dist:linux` host distro.
- [ ] Se bumpa la versione: `/.version` aggiornato + `npm run version:sync`.
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


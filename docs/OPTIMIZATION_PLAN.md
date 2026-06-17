# Piano di Ottimizzazione Approfondita (v2.1+) - Revisione Dettagliata

**Stato:** In Lavorazione
**Owner:** Maintainer StreamAI-IPTV
**Data:** 2026-05-27

## 1. Visione e Obiettivi

L'applicazione ha raggiunto la maturità funzionale con la migrazione a Wails v3. Questa fase si concentra sulla trasformazione da "funzionante" a "eccezionalmente performante". L'obiettivo è ottenere una reattività istantanea dell'interfaccia, tempi di caricamento quasi nulli e un utilizzo efficiente delle risorse di sistema (CPU, RAM, GPU), anche in condizioni di stress (playlist immense, hardware datato).

### 1.1. Metriche Chiave di Successo (KPIs)

- **Caricamento Profilo (15.000+ canali):** Riduzione del tempo di parsing, indicizzazione e visualizzazione del 70%.
- **Ricerca/Filtro Catalogo:** Risultati istantanei (< 16ms, entro un frame) mentre l'utente digita.
- **Avvio Applicazione (Cold Start):** < 300ms per visualizzare la UI interattiva (Time to Interactive).
- **Utilizzo RAM (Idle):** Riduzione del 30% grazie a una gestione della memoria più aggressiva e strutture dati allineate.
- **Fluidità UI:** Mantenere costantemente 60 FPS durante lo scrolling, la navigazione e le animazioni, eliminando ogni "jank" (blocco del main thread).

---

## 2. Metodologia d'Indagine

L'ottimizzazione deve essere guidata dai dati, non da supposizioni.

### 2.1. Profiling Backend (Go)

- **Stato:** ✅ **Implementato**
- **Strumenti:** `net/http/pprof`, `trace`, `benchstat`, `go-torch` (per flame graph).
- **Azioni & Consigli Pratici:**
    1.  **Esposizione Endpoints:** Integrare `net/http/pprof` in una porta locale accessibile solo durante lo sviluppo (es. `localhost:6060/debug/pprof/`).
    2.  **Flame Graphs:** Utilizzare `go-torch` per generare grafici a fiamma interattivi e identificare le funzioni "calde" (CPU-bound) durante il caricamento di una playlist massiva.
    3.  **Heap Profiling:** Analizzare le allocazioni con `go tool pprof -alloc_objects` per individuare memory leak o eccessiva generazione di garbage. Cercare oggetti che sopravvivono a più cicli di GC senza motivo.
    4.  **Trace:** Usare `go tool trace` per visualizzare la latenza della concorrenza, individuare goroutine bloccate, contesa sui lock (`mutex contention`) o passaggi di contesto (context switching) eccessivi.

#### Guida Pratica al Profiling del Backend

**1. Avvio dell'Applicazione in Modalità Profiling:**

   - **Da GoLand:**
     - Seleziona la configurazione di esecuzione **`Build and Profile with pprof`**.
     - Avviala (Run). L'applicazione partirà e il server `pprof` sarà attivo su `http://localhost:6060`.
     - Vai al menu `Run -> Profile -> Attach to Process...` e seleziona il processo della tua applicazione. GoLand si collegherà automaticamente e aprirà la vista del profiler.

   - **Da Riga di Comando:**
     ```bash
     # Avvia l'applicazione con il tag di build per pprof
     go run -tags dev_pprof ./cmd/streamai
     ```

**2. Esempi di Analisi con `go tool pprof`:**

   Una volta che l'app è in esecuzione, apri un nuovo terminale.

   - **Analisi CPU (30 secondi):**
     - Esegui nell'app l'azione che vuoi analizzare (es. carica una playlist pesante).
     - Lancia questo comando. Raccoglierà dati per 30 secondi e poi aprirà un'interfaccia web per l'analisi.
     ```bash
     go tool pprof -http=:8080 http://localhost:6060/debug/pprof/profile?seconds=30
     ```
     - Nel browser, naviga su `http://localhost:8080/ui/`. Cerca la vista "Flame Graph" per un'analisi visuale intuitiva.

   - **Analisi della Memoria (Heap):**
     - Analizza gli oggetti attualmente in memoria.
     ```bash
     go tool pprof -http=:8080 http://localhost:6060/debug/pprof/heap
     ```
     - Cerca la vista "Graph" per vedere quali funzioni stanno allocando più memoria.

   - **Analisi delle Goroutine:**
     - Controlla se ci sono "leak" di goroutine (goroutine che non terminano mai).
     ```bash
     go tool pprof -http=:8080 http://localhost:6060/debug/pprof/goroutine
     ```

   - **Execution Tracer (Analisi Avanzata):**
     - Cattura una traccia di 5 secondi per un'analisi dettagliata di latenza, concorrenza e GC.
     ```bash
     curl -o trace.out http://localhost:6060/debug/pprof/trace?seconds=5
     go tool trace trace.out
     ```

### 2.2. Profiling Frontend (React)

- **Stato:** ✅ **Implementato**
- **Strumenti:** React Profiler, Chrome/Edge DevTools (Performance tab, Memory Allocation Timeline, Lighthouse).
- **Azioni & Consigli Pratici:**
    1.  **Identificare i colli di bottiglia del Main Thread:** Cercare compiti lunghi (Long Tasks > 50ms) nella tab Performance durante lo scrolling o la ricerca. Analizzare la causa (Scripting, Rendering, Painting).
    2.  **Analisi Heap Snapshot:** Catturare snapshot prima e dopo il caricamento di una playlist per assicurarsi che i vecchi profili vengano raccolti dal Garbage Collector (no memory leak in JS).
    3.  **Lighthouse:** Usare il pannello Lighthouse dei DevTools per ottenere un report automatico sulle performance, inclusi i "Largest Contentful Paint" (LCP) e "Time to Interactive" (TTI).

#### Guida Pratica al Profiling del Frontend

**1. Avvio dell'Applicazione in Modalità Profiling:**

   - Avvia l'applicazione in modalità sviluppo.
   - Aggiungi `?profile=true` all'URL nella finestra dell'applicazione (es. `http://localhost:3000/?profile=true`). Questo caricherà la pagina `PerformanceProfiler` con gli scenari di stress test.

**2. Esempi di Analisi con i DevTools:**

   - **Analisi dei Componenti React:**
     - Apri i React DevTools e vai alla tab "Profiler".
     - Clicca sul pulsante di registrazione (il cerchio blu).
     - Interagisci con uno scenario (es. "Start Rapid Updates").
     - Ferma la registrazione.
     - Analizza il "Flamegraph" per vedere quali componenti si sono renderizzati e perché (se l'opzione è attiva). Cerca componenti che si ri-renderizzano senza che le loro props siano cambiate.

   - **Analisi delle Performance Generali:**
     - Vai alla tab "Performance" dei DevTools del browser.
     - Clicca su "Record".
     - Interagisci con uno scenario (es. scorri velocemente la lista di 20.000 elementi).
     - Ferma la registrazione.
     - Cerca barre rosse nella timeline che indicano "jank" (blocchi). Seleziona un "Long Task" per vedere la catena di eventi che l'ha causato (es. un calcolo JavaScript pesante).

---

## 3. Fase 1: Ottimizzazione del Backend (Go) - "Infrastruttura ad Alte Prestazioni"

### Nota Critica sul Workflow di Sviluppo
**Dopo aver aggiunto o modificato un servizio Go, è obbligatorio rigenerare i binding TypeScript** eseguendo `wails generate bindings` (o `npm run wails:bindings`). In caso contrario, il frontend non vedrà le modifiche, causando errori `TypeError: undefined is not an object` a runtime.

### 3.1. Pipeline di Parsing M3U/Xtream Avanzata

- **Azione:** Implementare un pattern "Fan-out/Fan-in".
    - `Fetcher`: Scarica il file a chunk (es. `io.Reader` con buffer da 64KB) per non saturare la RAM.
    - `Workers (Fan-out)`: N goroutine (pari al numero di core CPU) leggono dal buffer, eseguono il parsing delle stringhe usando `bytes.IndexByte` o parsing custom zero-allocation (evitando `strings.Split` che alloca molta memoria).
    - `Aggregator (Fan-in)`: Raccoglie le struct parsate e le inserisce in batch in un database locale o in un indice in memoria.
- **Consiglio Tecnico (Zero-Allocation):** Durante il parsing M3U, usare fette di byte (`[]byte`) che puntano al buffer originale del file scaricato, anziché allocare nuove stringhe (`string()`) per ogni nome di canale o URL. Per il parsing JSON da Xtream, considerare librerie come `valyala/fastjson` che evitano allocazioni.

### 3.2. Ottimizzazione delle Strutture Dati e Memoria

- **Memory Alignment:** Riorganizzare i campi delle `struct` Go (canali, film, serie) ordinandoli dal più grande al più piccolo (es. `int64` prima di `bool`) per ridurre il "padding" inserito dal compilatore, risparmiando megabyte su array di 100.000 elementi.
- **Riduzione Puntatori per il GC:** Meno puntatori ci sono nelle struct a lunga vita, meno lavoro dovrà fare il Garbage Collector. Valutare l'uso di indici (ID numerici) invece di puntatori diretti per le relazioni tra categorie e canali.
- **String Interning:** Per stringhe duplicate (es. nomi di gruppi, generi), usare un "interner" per memorizzare una sola copia di ogni stringa e usare puntatori a quella copia, riducendo drasticamente l'uso della memoria.
- **Storage Locale Veloce:** Invece di tenere tutto l'M3U parsato in RAM, valutare l'uso di un key-value store embeddato ad alte prestazioni in Go come **`bbolt`** (ottimo per letture veloci) o **`Pebble`** (derivato da RocksDB, ottimo per scritture concorrenti). Questo permette di caricare in RAM solo i canali visualizzati al momento, abbattendo l'impronta di memoria.

### 3.3. Tuning del Proxy IPTV HTTP

- **Connection Pooling:** Nel `ProxyService`, assicurarsi che `http.Transport` sia configurato con `MaxIdleConns`, `MaxIdleConnsPerHost` e `IdleConnTimeout` appropriati. Creare nuove connessioni TCP/TLS per ogni frammento HLS è letale per le performance.
- **Buffer Pooling:** Utilizzare `sync.Pool` per i buffer usati in `io.Copy` durante l'inoltro dello stream video dal provider al webview, azzerando le allocazioni durante il playback.
- **Alternative a `net/http`:** Per la massima performance, considerare di sostituire il server `net/http` con `valyala/fasthttp`, che è ottimizzato per alte prestazioni e basse allocazioni. **Attenzione:** `fasthttp` ha un'API diversa e non è un sostituto drop-in.

### 3.4. Ottimizzazione Player & Zero-Copy Rendering (SPIKE-5)

- **Problema:** Copiare frame video (specialmente 4K YUV420p) dalla VRAM alla RAM e viceversa consuma troppa larghezza di banda del bus di sistema.
- **Soluzione Linux (DMA-BUF):** Implementare EGL image extension. `libmpv` decodifica il video (via VAAPI/NVDEC) direttamente in un buffer DMA. Wails/WebKitGTK importa questo buffer DMA come una texture WebGL senza alcuna copia sulla CPU.
- **Tuning libmpv:** Ottimizzare `mpv` settando `hwdec=auto-safe`, `vd-lavc-threads=N` (per codec software), e profili di caching (`cache=yes`, `demuxer-max-bytes=150M`) adattivi in base allo stato della rete misurato dal proxy. Per l'avvio, usare flag come `--no-config`, `--idle`, `--vo=gpu`.

---

## 4. Fase 2: Ottimizzazione del Frontend (React) - "60 FPS Costanti"

### 4.1. Web Workers per il Calcolo Pesante

- **Implementazione con Comlink:** Usare la libreria `Comlink` per esporre oggetti e funzioni dal Web Worker al main thread come se fossero asincrone, semplificando la comunicazione rispetto a `postMessage`.
- **Logica Off-Thread:** Affidare al Web Worker:
    - Indicizzazione Fuzzy Search (es. libreria `Fuse.js` o `MiniSearch` eseguite nel worker).
    - Ordinamento alfabetico o per data di enormi array.
    - Filtraggio complesso (es. "Tutti i film d'azione del 2023").
    - **Image Decoding:** Usare `createImageBitmap` nel worker per decodificare le immagini fuori dal main thread, evitando blocchi durante la visualizzazione di nuove copertine.

### 4.2. Virtualizzazione Intelligente e DOM Optimization

- **Miglioramento `react-window`:** 
    - Assicurarsi che l'elemento riga (`Row`) passato a `react-window` sia avvolto in `React.memo` e che riceva solo prop primitive (ID, o l'oggetto specifico congelato), evitando arrow function inline.
    - Implementare dimensioni dinamiche reali usando `react-virtualized-auto-sizer` in combinazione con un caching delle altezze.
- **CSS Containment:** Aggiungere `contain: strict;` (o `contain: layout style paint;`) ai container delle liste virtualizzate. Questo suggerisce al browser che i cambiamenti all'interno di quell'elemento non influenzeranno il layout del resto della pagina, isolando i ricalcoli del layout (Reflow) e migliorando enormemente le prestazioni di scorrimento.
- **`content-visibility: auto`:** Per browser moderni, questa proprietà CSS è una forma di virtualizzazione nativa. Combinata con `contain-intrinsic-size`, può delegare al browser gran parte del lavoro di virtualizzazione.

### 4.3. Ottimizzazione dello Stato e Re-rendering

- **Abbandonare Context API per Dati ad Alta Frequenza:** React Context provoca il re-render di tutti i consumatori quando il valore cambia. Per lo stato globale che cambia spesso (es. progresso player, buffer status, risultati ricerca), migrare a gestori di stato atomici come **Zustand** o **Jotai**. Questo permette ai componenti di iscriversi solo a parti specifiche dello stato (es. un componente legge solo il `volume`, senza aggiornarsi se cambia il `currentTime`).
- **Throttling degli Eventi DOM:** Eventi come `onMouseMove` (per nascondere l'OSD), `onScroll` o `timeupdate` del player scattano decine di volte al secondo. Devono sempre chiamare funzioni regolate da `requestAnimationFrame` o tramite `throttle` (es. max 1 volta ogni 100ms).
- **`useDeferredValue`:** Usare l'hook `useDeferredValue` di React per renderizzare versioni "vecchie" di parti della UI (es. i risultati della ricerca) mentre i dati nuovi vengono calcolati, mantenendo l'interfaccia reattiva.

### 4.4. Code Splitting e Ottimizzazione del Bundle

- **Route-Based Loading:** Caricare il componente `VideoPlayerNew` e i suoi pesanti import associati (logica bridge mpv) solo quando l'utente clicca su un canale, non all'avvio dell'app.
- **Lazy Loading Immagini Intelligente:** Implementare `IntersectionObserver` non solo per caricare le immagini di copertina (VOD/Serie), ma per *smontarle* se l'utente scorre molto lontano, liberando memoria video. Sostituirle temporaneamente con un placeholder in tinta unita ricavato da un colore predominante (blurhash) calcolato nel worker.
- **Analisi del Bundle:** Usare `rollup-plugin-visualizer` per generare una mappa interattiva del bundle JavaScript e identificare le librerie più pesanti che possono essere caricate in modo asincrono o sostituite.

---

## 5. Roadmap e Priorità di Esecuzione

| Priorità | Area | Task | Impatto Atteso | Sforzo |
| :--- | :--- | :--- | :--- | :--- |
| **P0** | Frontend | Migrazione gestione stato frequente a Zustand/Jotai | Eliminazione lag UI | Medio |
| **P0** | Backend | Connection/Buffer pooling nel Proxy HTTP | Stabilità playback, - CPU | Basso |
| **P1** | Frontend/Worker | Spostamento ricerca/filtri catalogo in Web Worker | Ricerca istantanea | Medio |
| **P1** | Backend | Pipeline parsing M3U (Fan-out) + allocazioni zero | Avvio profili velocissimo | Alto |
| **P2** | Backend/Player| Implementazione Zero-Copy rendering (DMA-BUF) | Playback 4K fluido su HW debole | Molto Alto |
| **P2** | Frontend | Code splitting aggressivo e CSS Containment | Avvio < 300ms | Basso |
| **P3** | Backend | Transizione a store locale (es. bbolt) per profili enormi | -30% RAM idle | Alto |

## 6. Checkpoint Continuo

Dopo ogni task completato, misurare i KPI definiti nella sezione 1.1 per confermare che l'ottimizzazione abbia portato un beneficio reale e non abbia introdotto regressioni di stabilità. Usare i CI runners per eseguire benchmark automatici sulle performance chiave (es. tempo di parsing di un file M3U di test da 50MB).
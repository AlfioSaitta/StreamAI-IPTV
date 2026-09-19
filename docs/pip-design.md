# Picture-in-Picture — design e stato (2026-09-18)

> Sostituisce la strategia descritta in `plan-go-wails-migration.md` §6.2, che
> presupponeva un `<video>` HTML. Quel presupposto è decaduto con il drop del
> player web (Fase 7.3, commit `01684c3`).

## 1. Il problema

Il PiP è una funzionalità **non negoziabile** del progetto (`AGENTS.md` §1:
"L'utente deve poter guardare uno stream mentre naviga"). Fino a oggi su
desktop non era implementato affatto: `VideoPlayerNew.tsx` conteneva un
`// TODO: Implement PiP for Wails`, e l'hook `usePictureInPicture` — mai
chiamato da nessun componente — funzionava solo con un `<video>`.

Cause, in ordine di importanza:

1. **Il video non è più un `<video>`.** Dopo la rimozione del player web, il
   frame arriva in un `<canvas>` WebGL2 alimentato da libmpv. L'API
   `HTMLVideoElement.requestPictureInPicture()` opera *solo* su elementi
   `<video>`: su un canvas non è invocabile.
2. **`document.pictureInPictureElement` resta quindi sempre `null`**, e con
   esso tutto il codice che sincronizzava lo stato dell'indicatore.
3. **Document PiP non è un'alternativa universale.**
   `documentPictureInPicture.requestWindow()` è una feature Chromium: assente
   su WebKitGTK (Linux, la piattaforma di sviluppo) e su WKWebView (macOS).
   Sarebbe utilizzabile solo su Windows/WebView2, creando tre esperienze
   diverse — contro il requisito "Uniform UI".
4. **Il pulsante era disabilitato a prescindere.** `pipSupported` (allora
   `nativePiPSupported`) era uno `useState(false)` il cui setter non veniva
   chiamato da nessuna parte: il pulsante PiP, nel player e nella schermata di
   errore, restava grigio e non cliccabile. Ora è un valore *derivato* dalla
   piattaforma (plugin nativo su Android, presenza della binding `host.pip` su
   desktop), quindi non può più divergere dalla realtà senza un errore di
   compilazione.

## 2. La soluzione: una seconda finestra Wails

`internal/services/pip` gestisce una finestra dedicata, always-on-top e
frameless, che carica lo stesso bundle del frontend con `?pip=1`.

```
┌─ Finestra principale ────────────┐        ┌─ Finestra PiP ───────────┐
│ App React completa               │        │ PipWindow.tsx            │
│  VideoPlayerNew                  │        │  canvas WebGL2           │
│   └ loop di render (rallentato)  │        │   └ loop di render (30fps)│
└──────────┬───────────────────────┘        └──────────┬──────────────┘
           │                                            │
           │      GET /player/frame?w=&h=               │
           └───────────────► middleware ◄───────────────┘
                        (asset server Wails)
                                 │
                        libmpv (processo Go)
                        audio ─► scheda audio  ← non passa dalla webview
```

Perché funziona su tutti e tre gli OS:

- **Nessun transport nuovo.** La finestra PiP scarica i frame dallo stesso
  middleware HTTP `/player/frame` già usato dalla finestra principale. Non
  serve IPC dedicato né memoria condivisa.
- **Nessuna dipendenza dalle API PiP del webview.** È una normale finestra
  Wails: quello che il runtime non offre, non ci serve.
- **L'audio non è coinvolto.** Vive nel processo Go (mpv) e continua a suonare
  qualunque finestra disegni i pixel. Non c'è nulla da sincronizzare.
- **Costo proporzionale alla finestra.** Il frame richiesto al backend è
  dimensionato sul canvas (≈480×270), quindi il render costa circa un quarto
  di un canvas 720p (~1 ms contro ~4.4 ms).

## 3. Chi disegna (e perché uno solo)

Quando il PiP si apre, il backend emette `pip:opened`; la finestra principale
**ferma** il proprio loop di render (`enabled: false`) e la finestra PiP
disegna a piena cadenza. Alla chiusura, `pip:closed` inverte.

Fermarlo, e non solo rallentarlo, serve a proteggere la cache dei frame nel
backend: è **una sola**, indicizzata per dimensione. Il PiP chiede frame
~480×270, la finestra principale fino a 720p: se entrambe continuassero a
chiedere, ogni richiesta troverebbe la cache di dimensioni diverse e
rifarebbe da capo la conversione colori — annullando proprio il gating
(`shouldReuseFrame`) che esiste per evitarlo. Fermando il loop principale la
cache appartiene a una sola finestra.

Il canvas principale resta sull'ultimo frame disegnato, coperto dall'avviso
"Video in Picture-in-Picture": senza, sembrerebbe un'app bloccata.

## 3-bis. Decorazioni: perché `Frameless: true` non basta su Linux

Wails v3 implementa `WebviewWindowOptions.Frameless` con una sola chiamata:
`gtk_window_set_decorated(FALSE)`. **Su X11 funziona; su Wayland no.**

GTK3 smette di disegnare le sue decorazioni, ma il compositor negozia le
decorazioni con `xdg-decoration`: non trovando una superficie di decorazione
lato client, ne disegna di proprie. La finestra PiP restava quindi con la
titlebar di KDE nonostante `Frameless: true`.

Verificato empiricamente su KDE Plasma 6 / KWin Wayland (openSUSE Tumbleweed,
GTK 3.24.53) con due finestre di prova identiche tranne che per il metodo:

| Metodo | Risultato a schermo |
|---|---|
| `gtk_window_set_decorated(FALSE)` (quello che fa Wails) | ❌ titlebar KWin presente |
| `gtk_window_set_titlebar(w, box_vuoto)` (CSD con titlebar vuota) | ✅ finestra pulita |

**Contromisura:** `internal/pkg/gtkframe` sostituisce, per le finestre
frameless, la titlebar di sistema con una titlebar **vuota lato client** — il
trick standard per GTK3 su Wayland. Il compositor vede un client che gestisce
le proprie decorazioni e non ne aggiunge.

Dettagli di implementazione che contano:

- Si applica a ogni toplevel con `decorated == FALSE` (`gtk_window_list_toplevels`),
  non a una finestra identificata per titolo: è la stessa condizione che Wails
  usa per "frameless", ed è idempotente.
- Gira sul **main loop di GTK** via `g_idle_add`/`g_timeout_add`, sicuri da
  thread non-main: la creazione della finestra è asincrona e il chiamante non è
  il thread della UI.
- Riprova per ~3 secondi: la GtkWindow può non esistere ancora quando `Open()`
  ritorna.
- Non tocca le finestre decorate (la finestra principale): aggiungervi una
  titlebar vuota darebbe una doppia barra.
- È un **workaround a una limitazione del runtime**, non una funzionalità: se
  Wails lo risolve, il package va cancellato.

Verifica: `go test -tags 'gtk3 gtkframetest' ./internal/pkg/gtkframe/`
(il tag `gtkframetest` tiene gli helper cgo fuori dal binario di produzione —
Go non permette cgo nei file `_test.go`).

## 4. Stato e ciclo di vita

| Aspetto | Scelta | Motivo |
|---|---|---|
| Idempotenza | `Open()` cerca la finestra per nome; se esiste la porta in primo piano | `P` premuto due volte non deve creare due finestre |
| Titolo | Conservato nel servizio Go, letto dalla vista via `State()` | La finestra è frameless: la barra è HTML e deve conoscere il nome del canale. Passarlo nell'URL sarebbe fragile (encoding, caratteri non ASCII) |
| Chiusura esterna | Hook su `events.Common.WindowClosing` → emette `pip:closed` | L'utente può chiudere dal window manager o con Alt+F4: senza hook la finestra principale resterebbe con il loop rallentato e il video a 0.5 fps |
| Deadlock | Il mutex **non** è mai tenuto durante `Window.Close()`; il titolo è in un `atomic.Pointer` | `Close()` fa scattare il callback di chiusura sullo stesso goroutine: con il lock tenuto sarebbe deadlock (i mutex Go non sono rientranti) |
| Stato dopo un reload | La finestra principale legge `State()` al mount | Un reload della webview azzera lo stato JS ma non il WindowManager |
| Chi disegna | Loop della finestra principale **fermo** (`enabled: false`) mentre il PiP è aperto | Una sola cache di frame nel backend: due dimensioni diverse se la invaliderebbero a vicenda, annullando il gating |
| Pulsante PiP | `pipSupported` è derivato dalla piattaforma, non uno stato | Era uno `useState(false)` mai aggiornato: il pulsante restava disabilitato anche dove la funzione esisteva |
| Sentry | Non inizializzato nella finestra PiP | Session Replay su una finestrella always-on-top sarebbe sproporzionato e comparirebbe come seconda sessione utente |

## 4-bis. Spostare la finestra

La finestra PiP è frameless: non ha barra del titolo di sistema, quindi può
essere spostata **solo** attraverso il meccanismo di Wails:

```
mousedown su un elemento con  --wails-draggable: drag
        │  (il runtime legge getComputedStyle dell'elemento sotto il mouse)
        ▼  invoke("wails:drag") con pulsante + coordinate
HandleMessage("wails:drag") → startDrag() → gtk_window_begin_move_drag()
```

`--wails-draggable` è una **custom property CSS**, quindi si eredita: marcare la
radice della vista rende trascinabile tutto il riquadro, e basta `no-drag` sui
pulsanti per lasciarli cliccabili (l'icona dentro il pulsante eredita il
`no-drag` del pulsante, quindi anche il click sull'icona funziona).

All'inizio l'area era la sola barra del titolo: 28 px, per di più nascosta
dopo 2,5 s di inattività — in pratica la finestra non si riusciva a spostare.
Ora si trascina da qualsiasi punto del video, come nei PiP nativi.

Un dettaglio del runtime che vale la pena conoscere: **un click senza
spostamento resta un click** — il trascinamento parte al primo movimento del
mouse, quindi non serve disattivarlo sul canvas (se un domani si vorrà il
click-per-pausa sul video, continuerà a funzionare).

## 4-ter. Ridimensionare la finestra

Il resize dai bordi **non è fornito dal runtime su Linux**. In `drag.js`:

```js
if (!resizable || !IsWindows()) {   // ← su Linux si esce qui
    if (resizeEdge) setResize();
    return;
}
```

Il rilevamento dei bordi è quindi **solo Windows**. Il lato Go invece è pronto
anche su GTK3 (`startResize` → `gtk_window_begin_resize_drag`), e le coordinate
del click sono già registrate dal gestore nativo `button-press-event`
(`onButtonEvent` → `w.drag`), che **non consuma** l'evento (restituisce FALSE).

Quindi la vista PiP disegna le proprie maniglie (8 zone invisibili sui bordi e
sugli angoli, con il cursore giusto e `no-drag` per non far partire lo
spostamento) e al mousedown chiede il resize:

```
mousedown sulla maniglia → host.pip.startResize("se-resize")
   → (binding) pip.Service.StartResize
   → Window.HandleMessage("wails:resize:se-resize")   ← API pubblica di Wails
   → startResize → gtk_window_begin_resize_drag(…, w.drag.{MouseButton,XRoot,YRoot,DragTime})
```

Perché passare da `HandleMessage` e non dal runtime JS: `@wailsio/runtime` **non
esporta** `invoke` (l'exports map del pacchetto espone solo `.` e `./plugins/*`),
e quel messaggio è comunque l'unico percorso che riusa le coordinate native.

La capacità arriva dal backend (`WindowState.EdgeResize`), non da uno sniffing
della piattaforma nel componente: è `true` su Linux, `false` altrove — su
Windows il resize lo gestisce già il runtime, e aggiungere maniglie nostre lì
sarebbe un secondo meccanismo in concorrenza col primo.

**Le maniglie devono essere l'ultimo blocco del DOM** (o comunque sopra le due
barre: `z-20` contro `z-10`). Nel primo tentativo erano renderizzate prima, e le
barre le coprivano: la barra del titolo (28 px) rendeva irraggiungibili il bordo
nord e i due angoli superiori, i controlli in basso il bordo sud e i due angoli
inferiori — **incluso quello in basso a destra, il primo che si prende per
ridimensionare**. Restavano solo i due lati verticali, 6 px ciascuno. Il sintomo
("non si ridimensiona") era quindi reale e non dipendeva dal compositor.
Guard: `frontend/tests/ui/pipWindowDrag.test.tsx` (verifica che dopo la prima
maniglia non ci sia nessun altro elemento, e che abbiano `z-20`).

`StartResize` logga `pip: resize richiesto` con il bordo: se un domani il resize
non funzionasse, quel messaggio distingue "la maniglia non è raggiungibile"
(lato vista, nessun log) da "il compositor/GTK rifiuta" (log presente).

## 4-quater. "Sempre sopra" e finestra principale

**Su Wayland un client non può chiedere di restare sopra le altre finestre:**
non esiste un protocollo per farlo, quindi `AlwaysOnTop` (che Wails implementa
con `gtk_window_set_keep_above`) resta senza effetto. Funziona su X11, Windows
e macOS.

Verificato in questa sessione (KDE Plasma 6 / KWin Wayland): una normale
applicazione GTK3 viene aperta da GDK sul display **`wayland-0`** e non compare
fra i client X11 — quindi non è il caso XWayland, dove `_NET_WM_STATE_ABOVE`
sarebbe onorato.

Workaround, in ordine di praticità:

1. **Regola di finestra di KWin** (la soluzione consigliata, persiste). Lo
   script `scripts/kwin-pip-above.sh` la crea con gli strumenti ufficiali di
   KDE:

   ```bash
   scripts/kwin-pip-above.sh            # crea o aggiorna la regola
   scripts/kwin-pip-above.sh --status   # cosa è impostato ora
   scripts/kwin-pip-above.sh --remove   # la toglie
   ```

   La regola fa una cosa sola: **titolo = `StreamAI PiP`** → *Mantieni sopra le
   altre finestre* = *Forza*. Il titolo di sistema del PiP è costante e coincide
   con la stringa cercata (§ qui sotto), quindi la regola funziona con
   qualunque *modo di confronto*: in `kwinrulesrc` quel modo è un numero
   (`titlematch`) e un confronto "esatto" su un titolo variabile fallirebbe **in
   silenzio**. Equivalentemente, a mano: Impostazioni di sistema → Regole delle
   finestre → Nuova → *Rileva proprietà finestra* → titolo `StreamAI PiP` →
   *Mantieni sopra le altre* = *Forza*.

   Perché uno script e non una cosa che fa l'app da sola: impostare la regola
   significa scrivere nella configurazione di KWin dell'utente, e un player non
   deve modificare la configurazione del desktop di nascosto. Lo script è
   esplicito, ispezionabile e reversibile.
2. **Avviare l'app sotto XWayland** (`GDK_BACKEND=x11 streamai`): lì
   `_NET_WM_STATE_ABOVE` è onorato da KWin. Costo: un livello di compatibilità
   in più per tutto il rendering.
3. Conviverci: la finestra PiP è piccola e si sposta con un trascinamento.

**Valutato e scartato:** impostare `keepAbove` dal vivo tramite lo scripting di
KWin (`org.kde.KWin.Scripting` + `callDBus`). Funzionerebbe in teoria — le
regole del compositor agiscono a livello di KWin, quindi non soffrono della
limitazione di protocollo — ma significa caricare uno script JavaScript nel
compositor dell'utente da un player video: una capacità sproporzionata per
questo requisito, e non verificabile in modo affidabile. La regola (1) ottiene
lo stesso risultato restando nel perimetro di ciò che l'utente controlla.

Per rendere possibile il criterio (1) il titolo **di sistema** del PiP è
costante: `StreamAI PiP` (`osTitle` in `internal/services/pip`). Niente nome del
canale: cambia a ogni zapping, e un titolo variabile costringerebbe la regola a
un confronto per sottostringa — cioè a indovinare il valore numerico di
`titlematch` scritto in `kwinrulesrc`, che se sbagliato rende la regola inerte
senza alcun segnale. Con titolo della finestra e stringa cercata **identici** il
confronto riesce in tutti e tre i modi (esatto, sottostringa, espressione
regolare: la stringa non ha metacaratteri). Il valore Go e quello nello script
sono tenuti agganciati da `TestOSTitle_MatchesWindowRuleScript`: sono due
artefatti in linguaggi diversi e nulla li legherebbe a compile-time.

La barra HTML della vista e `WindowState.Title` continuano a mostrare il nome
del canale, che resta quindi visibile nell'interfaccia del PiP.

L'app lo dice nel log all'apertura del PiP quando rileva Wayland, per non farlo
sembrare un difetto dell'applicazione.

**La finestra principale va a icona** mentre il PiP è aperto
(`minimiseMainWindow`) e viene ripristinata alla chiusura. Due accorgimenti:

- `restoreMainWindow` deiconifica **solo** se la finestra è ridotta a icona:
  riportare in primo piano una finestra che l'utente ha ridotto per conto suo
  sarebbe un furto di focus.
- Dopo la riduzione si riporta il focus sul PiP: senza focus le sue scorciatoie
  (Spazio, M, Esc) non arriverebbero più.

Verifica: `frontend/tests/ui/pipWindowDrag.test.tsx` (radice `drag`, canvas che
eredita, pulsanti `no-drag`, 8 maniglie `no-drag` con il bordo giusto, mousedown
che chiede il resize), `frontend/tests/ui/pipControls.test.tsx` (timeline solo
per contenuti cercabili, un seek al rilascio, salti e frecce, fullscreen,
`Esc` che esce dal fullscreen, `no-drag` su tutti i controlli) e
`internal/services/pip/service_test.go` (bordi accettati, `Update` senza
finestra, round-trip del tipo di canale).

## 4-quinquies. Controlli della finestra PiP

La finestra PiP non è una scatola nera: ha i controlli che servono a guardare
qualcosa senza tornare all'applicazione, e solo quelli. Tracce, sottotitoli,
EPG e cast restano nella finestra principale.

| Controllo | Quando | Perché |
|---|---|---|
| Timeline trascinabile | solo contenuti **cercabili** | su un canale live la durata non è nota e il seek non ha senso; se il probe dice che il server non supporta il range (`Accept-Ranges: none`) la barra resta visibile ma **non** trascinabile, perché nasconderla farebbe sembrare il contenuto non cercabile per un difetto dell'app |
| Salto ±10 s | come sopra | alternativa veloce al trascinamento, in una finestra larga 480 px |
| Play/Pausa, Mute + volume | sempre | sono le azioni che si usano di più |
| Tutto schermo | sempre | è l'unico modo di ingrandire senza riportare in primo piano la finestra principale |
| Chiudi | sempre | ripristina la finestra principale (che all'apertura del PiP va a icona) |

**Un solo seek al rilascio.** La timeline usa lo stesso hook della finestra
principale (`useInteractiveTimeline`, scritto per l'incidente "seek-storm"):
emette la ricerca quando si rilascia il cursore, non a ogni pixel di
trascinamento. Due implementazioni diverse avrebbero significato due
comportamenti dello stesso gesto in due finestre della stessa applicazione.

**Esc in fullscreen esce dal fullscreen**, non chiude il PiP: è ciò che fa
qualunque player, e altrimenti per tornare alla finestra principale servirebbe
il mouse — cioè l'opposto del requisito "controllabile al 100% da tastiera".

**Il fullscreen è della finestra PiP, non dell'applicazione**
(`pip.Service.ToggleFullscreen`). Lo stato dell'icona si rilegge da `State()`:
su GTK il fullscreen è una richiesta al compositor e non si applica in modo
sincrono, e il compositor può uscire dal fullscreen per conto suo (scorciatoia
di sistema). Il momento della rilettura non è casuale — quando i controlli
ricompaiono, che è l'unico istante in cui quell'icona è visibile.

**Il canale può cambiare mentre il PiP è aperto.** È lo scenario normale: il PiP
esiste per guardare altro mentre si naviga. `pip.Service.Update` aggiorna titolo
e tipo di canale della finestra già aperta e notifica la vista con
`pip:updated`; **non** chiama `Focus()`, altrimenti ogni zapping ruberebbe il
focus alla finestra principale mentre l'utente sta navigando. Senza questo
aggiornamento la barra restava sul canale di apertura e la timeline veniva
disegnata per il tipo sbagliato (barra di posizione su un live, o nessuna barra
su un film).

Tutti i controlli sono `no-drag`: la radice della finestra è trascinabile,
quindi un pulsante senza `no-drag` sposterebbe la finestra invece di rispondere
al click. Guard: `frontend/tests/ui/pipControls.test.tsx`.

## 5. Scorciatoie

| Tasto | Azione |
|---|---|
| `P` | Apre/chiude il PiP |
| `Spazio`, `Invio` | Play/Pausa |
| `Esc` (nella finestra PiP) | Esce dal tutto schermo se attivo, altrimenti chiude il PiP |
| `M` (nella finestra PiP) | Mute |
| `F` (nella finestra PiP) | Tutto schermo |
| `←` / `→` (nella finestra PiP) | Salto ∓10 s, solo contenuti cercabili |

**Cambio di mappatura (2026-09-18).** `P` era assegnato a Play/Pausa, che ha
già `Spazio` e `Invio`; il PiP non aveva alcuna scorciatoia. `AGENTS.md`
assegnava `P` a entrambe le funzioni: la tabella scorciatoie vinceva nel
codice, la sezione Picture-in-Picture descriveva l'intenzione. Si è scelto di
dare `P` al PiP e lasciare Play/Pausa su `Spazio`/`Invio`.

Se il consumer non fornisce `togglePip` (es. player nativo Android, dove il PiP
è gestito dal plugin Capacitor), il tasto `P` **non** ricade su Play/Pausa: una
scorciatoia che cambia significato in base alla piattaforma è peggio di una
scorciatoia assente.

## 6. Cosa NON è coperto

- **PiP fuori dall'app** (finestra che resta quando l'app è chiusa): non ha
  senso, l'audio verrebbe da un player terminato.
- **Controlli completi nella finestra PiP**: ci sono solo play/pausa, mute e
  chiudi. Timeline, tracce, sottotitoli restano nella finestra principale.
- **Ricordo di posizione e dimensione** tra sessioni: la finestra si apre
  centrata. Da valutare se diventa fastidioso.
- **Android**: invariato, usa `nativeVideoPlayer.enterPictureInPicture()`
  (plugin Capacitor).

## 7. Verifica

| Gate | Esito |
|---|---|
| `go build -tags 'gtk3 mpv' ./...` | ✅ |
| `go test -tags 'gtk3' ./internal/services/pip/` | ✅ (degrado senza app Wails, round-trip del titolo, guard titolo↔script della regola) |
| `npx tsc --noEmit` | ✅ |
| `npx vitest run` | ✅ 209/209 |
| `npx vite build` | ✅ |
| `go test -tags 'gtk3 gtkframetest' ./internal/pkg/gtkframe/` | ✅ (titlebar applicata alle frameless, non alle decorate) |
| Decorazioni assenti a schermo | ✅ verificato con sonda GTK3 su KWin/Wayland (tabella §3-bis) |
| Prova manuale `P` / chiusura con Alt+F4 | ⚠️ da fare su build reale |

La prova manuale è necessaria perché nessun test automatico può verificare la
creazione di una seconda finestra: va fatto guardando l'app.

# 📺 StreamAI IPTV Player

**StreamAI** è un player IPTV di nuova generazione sviluppato con **React 19**, **TypeScript** e **Tailwind CSS**. 
Si distingue per l'integrazione con **Google Gemini AI**, che offre raccomandazioni intelligenti sui canali basate sul mood dell'utente.

---

## 🚀 Requisiti

*   **IDE**: [JetBrains WebStorm](https://www.jetbrains.com/webstorm/) (consigliato).
*   **Node.js**: Richiesto solo per pacchettizzare l'app desktop (Electron).
*   **Browser**: Chrome, Edge, Safari o Firefox (versione recente) per uso web.

---

## 🛠 Configurazione in WebStorm

Il progetto include la cartella `.idea` configurata.

1.  Apri WebStorm e seleziona **Open** sulla cartella del progetto.
2.  WebStorm indicizzerà automaticamente i file.
3.  Apri il terminale integrato di WebStorm (`Alt+F12`).
4.  Esegui `npm install` per scaricare le dipendenze necessarie per la versione Desktop/Linux (Electron).

---

## ▶️ Come Avviare (Modalità Sviluppo)

### Opzione A: Solo Web (Veloce)
1.  Fai tasto destro su `index.html`.
2.  Seleziona **Run 'index.html'**.

### Opzione B: Client Desktop (Electron)
Se vuoi testare l'esperienza nativa Linux/Desktop:
1.  Esegui nel terminale:
    ```bash
    npm start
    ```
    Si aprirà una finestra applicativa dedicata.

---

## 🐧 Creare l'Eseguibile per Linux

Per creare un pacchetto portabile (`.tar.gz`) che non richiede installazione:

1.  Assicurati di aver eseguito `npm install`.
2.  Esegui il comando di build:
    ```bash
    npm run dist:linux
    ```
3.  Troverai l'archivio compilato nella cartella `dist/`.
    *   Estrai il file `.tar.gz`.
    *   Esegui il file eseguibile `streamai-iptv` contenuto nella cartella estratta.

---

## 📱 Web & PWA

L'app rimane compatibile al 100% come PWA per Android/iOS.
Poiché l'app utilizza **Babel Standalone**, non è necessario alcun processo di build per la versione web. Copia semplicemente tutti i file (eccetto `node_modules`, `.idea` e `dist`) sul tuo server web.

---

## 🤖 Configurazione API Key Gemini

Per le raccomandazioni AI, imposta la tua chiave API. 
*Nota*: In ambiente desktop, le variabili d'ambiente di sistema possono essere lette se configurate nel processo Electron, ma per questa demo assicurati di gestire la chiave in `services/geminiService.ts`.
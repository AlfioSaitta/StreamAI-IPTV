import React from 'react';

/**
 * La finestra Wails è configurata frameless?
 *
 * Deve rispecchiare `Frameless` in `application.WebviewWindowOptions`
 * (`cmd/streamai/main.go`). Al momento è `false`: la finestra ha la title bar
 * nativa, che gestisce già il trascinamento.
 */
export const WAILS_WINDOW_IS_FRAMELESS = false;

const TITLEBAR_HEIGHT = 32;

/**
 * Regione trascinabile per una title bar custom (solo finestra frameless).
 *
 * Wails v3 non espone alcuna API JS per il drag: il trascinamento si dichiara
 * via CSS con `--wails-draggable: drag` sulle aree trascinabili (e `no-drag`
 * sui figli interattivi). La versione precedente chiamava `Window.Drag()`, che
 * non esiste nel runtime: ogni `mousedown` sulla striscia lanciava
 * `TypeError: Window.Drag is not a function`.
 *
 * Va montata **solo** con `Frameless: true`: altrimenti la striscia è
 * invisibile ma intercetta i click sui primi {@link TITLEBAR_HEIGHT}px della
 * finestra, rendendo non cliccabile qualunque controllo finisca lassù.
 */
const TitleBar: React.FC = () => (
  <div
    style={
      {
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100%',
        height: `${TITLEBAR_HEIGHT}px`,
        zIndex: 1000,
        '--wails-draggable': 'drag',
      } as React.CSSProperties
    }
  />
);

export default TitleBar;

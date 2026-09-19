import React from 'react';
import ReactDOM from 'react-dom/client';
import * as Sentry from "@sentry/react";
import App from './App.tsx';
import PipWindow from './components/PipWindow.tsx';
import './index.css';

/**
 * La stessa build serve due documenti: l'app completa e la finestra
 * Picture-in-Picture, che il backend apre su `?pip=1` (vedi
 * `internal/services/pip`). Il discriminante è il query param, non il path,
 * perché entrambe le finestre caricano la stessa entry HTML di Vite.
 */
const isPipWindow = new URLSearchParams(window.location.search).get('pip') === '1';

// Sentry NON viene inizializzato nella finestra PiP: è una vista minima che
// disegna frame, e Session Replay (che registra il DOM) sarebbe sproporzionato
// per una finestrella always-on-top. Soprattutto, la sua sessione comparirebbe
// come una seconda sessione utente, inquinando le metriche.
if (!isPipWindow) {
  Sentry.init({
    dsn: "https://1ed61c33c431587bec1c76a3db950908@o4508166622806016.ingest.de.sentry.io/4511451808006224",
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration(),
    ],
    // Performance Monitoring
    tracesSampleRate: 1.0, // Capture 100% of the transactions, reduce in production!
    // Session Replay
    replaysSessionSampleRate: 0.1, // This sets the sample rate to 10%. You may want to change it to 100% while in development and then sample at a lower rate in production.
    replaysOnErrorSampleRate: 1.0, // If you're not already sampling the entire session, change the sample rate to 100% when sampling sessions where errors occur.
  });
}


const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    {isPipWindow ? (
      <PipWindow />
    ) : (
      <Sentry.ErrorBoundary fallback={<p>An error has occurred</p>}>
        <App />
      </Sentry.ErrorBoundary>
    )}
  </React.StrictMode>
);

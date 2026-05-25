/**
 * usePictureInPicture — Fase 6.2 del plan-go-wails-migration.
 *
 * Hook React per togglare il Picture-in-Picture in modo agnostico
 * rispetto all'engine player sottostante (Video.js, native libmpv,
 * `<video>` raw). Implementa la **strategia automatica** documentata
 * nel plan §6.2:
 *
 *   1. **Document PiP API** (`window.documentPictureInPicture.requestWindow`):
 *      preferenza assoluta su Chromium-based webview (WebView2 evergreen,
 *      WebKitGTK 6.0 ≥ 2.44). Permette UI custom HTML nella finestra PiP.
 *      Non disponibile su WebKitGTK 4.1 (Ubuntu 24.04 stock) né su
 *      WKWebView (macOS ≤ 14).
 *
 *   2. **HTMLVideoElement.requestPictureInPicture()** (W3C PiP API):
 *      fallback universale per `<video>` element. Solo il video viene
 *      proiettato, niente UI custom. Funziona su WebKitGTK 4.1+, WKWebView,
 *      WebView2 evergreen. **Path attuale** finché la Fase 6.1 non sostituisce
 *      Video.js con `useNativeMpvEngine` (che renderizza su `<canvas>` e
 *      richiederà la strategia 1 o 3).
 *
 *   3. **Wails second-window** (`WindowService.OpenPipWindow()` Go-side):
 *      fallback per i casi in cui le strategie 1+2 falliscono (es.
 *      `<canvas>` puro senza video element). **Non implementato qui** —
 *      l'hook delega allo `onUnsupported` callback del consumer, che può
 *      decidere se mostrare un toast o invocare un binding Wails dedicato
 *      (sarà aggiunto in Fase 6.2 step 3 quando il backend lo esporrà).
 *
 * Uso tipico (consumer = VideoPlayerNew.tsx o equivalente):
 *
 *   const videoRef = useRef<HTMLVideoElement>(null);
 *   const { isPip, supported, toggle } = usePictureInPicture({
 *     videoRef,
 *     onChange: (active) => console.log('PiP', active ? 'on' : 'off'),
 *     onUnsupported: () => showOsd('PiP non disponibile'),
 *   });
 *
 * Eventi DOM `enterpictureinpicture` / `leavepictureinpicture` sono
 * registrati sul video element passato e mantengono `isPip` in sync
 * anche se l'utente chiude la PiP window dal chrome del browser.
 *
 * Su build mobile (Capacitor / Android Media3) questo hook è no-op:
 * il PiP native è gestito da `nativeVideoPlayer.enterPictureInPicture()`
 * (vedi `services/nativeVideoPlayer.ts`). I consumer dovrebbero
 * intercettare `platformService.isNative` prima di mountarlo.
 */

import { useCallback, useEffect, useState } from 'react';

export interface UsePictureInPictureOptions {
  /**
   * Ref al `<video>` element su cui invocare il PiP. Può essere null
   * finché il player non è mountato (l'hook è no-op fino a ref.current
   * non null). Quando si passa al rendering canvas (Fase 6.1), questa
   * opzione diventa optional e l'hook attiverà la strategia Document PiP.
   */
  videoRef?: React.RefObject<HTMLVideoElement | null>;

  /**
   * Ref opzionale a un `<canvas>` (es. canvas WebGL2 di `useNativeMpvEngine`)
   * per la strategia Document PiP. Se fornita, l'hook prova prima a
   * spostare il canvas nella finestra `documentPictureInPicture`. Da
   * usare solo quando si rinuncia al video element raw (Fase 6.1+).
   */
  canvasRef?: React.RefObject<HTMLCanvasElement | null>;

  /**
   * Callback invocata ogni volta che lo stato PiP cambia (sia per
   * toggle esplicito sia per chiusura via chrome del browser).
   */
  onChange?: (isPip: boolean) => void;

  /**
   * Callback invocata se nessuna delle strategie supportate è disponibile
   * (né Document PiP né `<video>.requestPictureInPicture`). Il consumer
   * tipicamente mostra un toast/OSD "PiP non disponibile".
   */
  onUnsupported?: () => void;
}

export interface UsePictureInPictureResult {
  /** True se attualmente in modalità Picture-in-Picture. */
  isPip: boolean;

  /**
   * True se almeno una strategia PiP è disponibile nel runtime corrente.
   * Calcolato al mount via feature detection. I consumer usano questo
   * per disabilitare il pulsante PiP nella UI.
   */
  supported: boolean;

  /**
   * Toggle PiP: se attivo lo chiude, altrimenti lo apre. Best-effort:
   * eventuali errori (es. user gesture mancante) vengono loggati come
   * warning e ritorna `false`. Ritorna `true` se la transizione è
   * andata a buon fine.
   */
  toggle: () => Promise<boolean>;

  /** Forza apertura PiP. No-op se già attivo. */
  enter: () => Promise<boolean>;

  /** Forza chiusura PiP. No-op se già chiuso. */
  exit: () => Promise<boolean>;
}

// Feature detection helpers ---------------------------------------------------

/** True se il runtime espone Document Picture-in-Picture API (Chromium >= 116). */
export function hasDocumentPipApi(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof (window as unknown as { documentPictureInPicture?: unknown })
      .documentPictureInPicture === 'object'
  );
}

/** True se il runtime espone HTMLVideoElement Picture-in-Picture API (W3C). */
export function hasVideoPipApi(): boolean {
  if (typeof document === 'undefined') return false;
  // `pictureInPictureEnabled` è false se l'utente ha disabilitato PiP
  // nelle preferenze browser o se il documento è in iframe sandbox.
  return !!document.pictureInPictureEnabled;
}

// Hook implementation ---------------------------------------------------------

export function usePictureInPicture(
  opts: UsePictureInPictureOptions = {},
): UsePictureInPictureResult {
  const { videoRef, canvasRef: _canvasRef, onChange, onUnsupported } = opts;
  const [isPip, setIsPip] = useState<boolean>(false);

  // Feature detection cristallizzato al primo render. Il valore non
  // cambia in-flight (le API PiP non vengono toglie a runtime in nessun
  // browser noto). `canvasRef` riservato a Fase 6.1+ (Document PiP per
  // canvas mpv) — per ora il check di supporto considera solo la
  // strategia 1+2.
  const [supported] = useState<boolean>(() => hasDocumentPipApi() || hasVideoPipApi());

  // Sync isPip con eventi DOM: l'utente può chiudere la PiP window
  // direttamente dal chrome del browser (X / pulsante "return to tab")
  // senza passare dal nostro toggle. Gli eventi standard sono
  // `enterpictureinpicture` / `leavepictureinpicture` su HTMLVideoElement.
  useEffect(() => {
    const video = videoRef?.current;
    if (!video) return;
    const handleEnter = () => {
      setIsPip(true);
      onChange?.(true);
    };
    const handleLeave = () => {
      setIsPip(false);
      onChange?.(false);
    };
    video.addEventListener('enterpictureinpicture', handleEnter);
    video.addEventListener('leavepictureinpicture', handleLeave);
    return () => {
      video.removeEventListener('enterpictureinpicture', handleEnter);
      video.removeEventListener('leavepictureinpicture', handleLeave);
    };
  }, [videoRef, onChange]);

  // Sync isPip iniziale: se l'app monta mentre il documento è già in
  // PiP (ricarica pagina con PiP attivo? scenario teorico), allinea
  // lo stato. La maggioranza dei browser disattiva PiP al refresh.
  useEffect(() => {
    if (typeof document !== 'undefined' && document.pictureInPictureElement) {
      setIsPip(true);
    }
  }, []);

  const enter = useCallback(async (): Promise<boolean> => {
    const video = videoRef?.current;
    if (!video) {
      // canvasRef path (Document PiP) sarà implementato in Fase 6.1+ con
      // la strategia 1. Per ora segnaliamo unsupported.
      onUnsupported?.();
      return false;
    }
    if (document.pictureInPictureElement === video) {
      return true; // già in PiP
    }
    if (!hasVideoPipApi()) {
      onUnsupported?.();
      return false;
    }
    try {
      await video.requestPictureInPicture();
      return true;
    } catch (err) {
      console.warn('[usePictureInPicture] enter failed:', err);
      return false;
    }
  }, [videoRef, onUnsupported]);

  const exit = useCallback(async (): Promise<boolean> => {
    if (typeof document === 'undefined' || !document.pictureInPictureElement) {
      return true; // già fuori
    }
    try {
      await document.exitPictureInPicture();
      return true;
    } catch (err) {
      console.warn('[usePictureInPicture] exit failed:', err);
      return false;
    }
  }, []);

  const toggle = useCallback(async (): Promise<boolean> => {
    if (typeof document !== 'undefined' && document.pictureInPictureElement) {
      return exit();
    }
    return enter();
  }, [enter, exit]);

  return { isPip, supported, toggle, enter, exit };
}

export default usePictureInPicture;


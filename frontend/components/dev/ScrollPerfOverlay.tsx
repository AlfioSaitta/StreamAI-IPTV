import React, { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Misuratore di fluidità dello scorrimento — **solo per lo sviluppo**.
 *
 * Si monta con `?perf=1` (stesso meccanismo di `?pip=1`), quindi non esiste
 * nell'app normale. Serve a non ottimizzare a naso: senza numeri, "sembra più
 * fluido" non è una verifica, e due scorrimenti fatti a mano non sono
 * confrontabili fra loro.
 *
 * Cosa misura, e perché proprio questo:
 *
 *  - **scarti fra fotogrammi** campionati con `requestAnimationFrame`:
 *    p50/p95/max su una finestra di 3 s. Il ritardo di consegna del fotogramma
 *    è ciò che l'utente percepisce, e include il tempo in cui il thread
 *    principale è bloccato;
 *  - **fotogrammi oltre 50 e 100 ms**, che sono gli scatti che si vedono;
 *  - **animazioni in corso** (`document.getAnimations()`): è la variabile di
 *    controllo. Se lavoriamo sulle animazioni e questo numero non scende, non
 *    abbiamo ottenuto nulla;
 *  - **conteggi di nodi** (card, righe, immagini): se cambiano fra una misura e
 *    l'altra, il confronto non vale;
 *  - **sonde di supporto**: `content-visibility` e `longtask`. Senza, una
 *    proprietà che il motore ignora sembra "non ha aiutato" invece di "non è
 *    stata applicata", e un `PerformanceObserver` assente sembra zero scatti.
 *
 * La **corsa di misura** è la parte che rende il confronto onesto: scorre il
 * documento di 6000 px in 4 s con passi espliciti, quindi ogni esecuzione fa
 * esattamente lo stesso gesto. Il p95 di quella corsa è il numero da
 * confrontare — non l'FPS istantaneo, che dipende da come hai mosso il mouse.
 *
 * Il pannello è `fixed` (altrimenti non si leggerebbe mentre si scorre) e
 * quindi costa qualcosa anche lui: è un costo **costante** fra la misura prima
 * e quella dopo, quindi si annulla nel confronto. Non ha animazioni, non ha
 * sfondi sfocati e si ridisegna due volte al secondo, proprio per non pesare
 * sulla misura.
 */

/** Finestra scorrevole delle statistiche. */
const FINESTRA_MS = 3000;
/** Ogni quanto si ridisegna il pannello. Vedi la nota sul costo costante. */
const RIDISEGNO_MS = 500;
/** La corsa di misura: sempre la stessa distanza nello stesso tempo. */
const CORSA_PX = 6000;
const CORSA_MS = 4000;

interface Fotogramma {
  t: number;
  dt: number;
}

interface Statistiche {
  fps: number;
  p50: number;
  p95: number;
  max: number;
  lunghi50: number;
  lunghi100: number;
  animazioni: number;
  card: number;
  righe: number;
  righeVisibili: number;
  img: number;
}

interface EsitoCorsa {
  p95: number;
  max: number;
  fotogrammi: number;
  lunghi: number;
}

const percentile = (valori: number[], p: number): number => {
  if (valori.length === 0) return 0;
  const ordinati = [...valori].sort((a, b) => a - b);
  const idx = Math.min(ordinati.length - 1, Math.floor((p / 100) * ordinati.length));
  return ordinati[idx];
};

const ms = (v: number): string => `${v.toFixed(1)} ms`;

/** Quante righe di catalogo stanno davvero a schermo adesso. */
const righeVisibili = (): number => {
  let n = 0;
  document.querySelectorAll('.offscreen-skip, .offscreen-skip-dense').forEach(el => {
    const r = el.getBoundingClientRect();
    if (r.bottom > 0 && r.top < window.innerHeight) n++;
  });
  return n;
};

const statSupportate = (): string[] => {
  // `PerformanceObserver` può non esistere affatto (webview minimali): un
  // riferimento nudo sarebbe un ReferenceError, non un "non supportato".
  if (typeof PerformanceObserver === 'undefined') return [];
  const tipi = (PerformanceObserver as unknown as { supportedEntryTypes?: string[] })
    .supportedEntryTypes;
  return Array.isArray(tipi) ? tipi : [];
};

const ScrollPerfOverlay: React.FC = () => {
  const fotogrammi = useRef<Fotogramma[]>([]);
  const lunghi = useRef<Fotogramma[]>([]);
  const corsa = useRef<{ attiva: boolean; dt: number[] }>({ attiva: false, dt: [] });
  /**
   * Id del `requestAnimationFrame` della corsa di misura.
   *
   * La corsa è un ciclo che chiama `window.scrollTo` a ogni fotogramma per
   * `CORSA_MS`: senza questo riferimento non c'era modo di fermarla, quindi
   * smontando il pannello mentre è in corso (o chiudendo l'app) il ciclo
   * proseguiva e l'app continuava a **scorrersi da sola** fino a 6 secondi.
   */
  const corsaRaf = useRef(0);
  const [stat, setStat] = useState<Statistiche | null>(null);
  const [corsaEsito, setCorsaEsito] = useState<EsitoCorsa | null>(null);
  const [inCorsa, setInCorsa] = useState(false);

  const supportaContentVisibility = React.useMemo(
    () => typeof CSS !== 'undefined' && CSS.supports?.('content-visibility', 'auto') === true,
    [],
  );
  const supportaLongTask = React.useMemo(() => statSupportate().includes('longtask'), []);

  // Campionatore: una voce per fotogramma, tenuta in un anello di 3 s.
  useEffect(() => {
    let raf = 0;
    let ultimo = performance.now();

    const giro = (t: number) => {
      const dt = t - ultimo;
      ultimo = t;
      // Un salto enorme non è uno scatto: è la finestra che è stata in
      // background (o il pannello che è appena comparso). Fuori statistica.
      if (dt < 1000) {
        fotogrammi.current.push({ t, dt });
        if (corsa.current.attiva) corsa.current.dt.push(dt);
      }
      const taglio = t - FINESTRA_MS;
      while (fotogrammi.current.length > 0 && fotogrammi.current[0].t < taglio) {
        fotogrammi.current.shift();
      }
      raf = window.requestAnimationFrame(giro);
    };

    raf = window.requestAnimationFrame(giro);
    return () => window.cancelAnimationFrame(raf);
  }, []);

  // Long task: se il motore non le espone, si dice "n/d" invece di zero.
  useEffect(() => {
    if (!supportaLongTask) return;
    let observer: PerformanceObserver;
    try {
      observer = new PerformanceObserver(list => {
        for (const _ of list.getEntries()) {
          lunghi.current.push({ t: performance.now(), dt: 0 });
        }
      });
      observer.observe({ entryTypes: ['longtask'] });
    } catch {
      return;
    }
    return () => observer.disconnect();
  }, [supportaLongTask]);

  // Il pannello si aggiorna a bassa frequenza: vedi la nota in testa.
  useEffect(() => {
    const id = window.setInterval(() => {
      const adesso = performance.now();
      const dt = fotogrammi.current.map(f => f.dt);
      const taglio = adesso - FINESTRA_MS;
      while (lunghi.current.length > 0 && lunghi.current[0].t < taglio) lunghi.current.shift();

      const secondi = FINESTRA_MS / 1000;
      setStat({
        fps: dt.length > 0 ? dt.length / secondi : 0,
        p50: percentile(dt, 50),
        p95: percentile(dt, 95),
        max: dt.length > 0 ? Math.max(...dt) : 0,
        lunghi50: dt.filter(v => v > 50).length / secondi,
        lunghi100: dt.filter(v => v > 100).length / secondi,
        animazioni:
          typeof document.getAnimations === 'function'
            ? document.getAnimations().filter(a => a.playState === 'running').length
            : 0,
        card: document.querySelectorAll('[id^="channel-"]').length,
        righe: document.querySelectorAll('.offscreen-skip, .offscreen-skip-dense').length,
        righeVisibili: righeVisibili(),
        img: document.images.length,
      });
    }, RIDISEGNO_MS);
    return () => window.clearInterval(id);
  }, []);

  // Ferma la corsa di misura se il pannello sparisce mentre è in corso: senza,
  // il ciclo di `scrollTo` resta orfano e continua a muovere la pagina.
  useEffect(() => () => {
    if (corsaRaf.current) window.cancelAnimationFrame(corsaRaf.current);
    corsa.current = { attiva: false, dt: [] };
  }, []);

  const eseguiCorsa = useCallback(() => {
    const partenza = window.scrollY;
    const t0 = performance.now();
    corsa.current = { attiva: true, dt: [] };
    setInCorsa(true);
    setCorsaEsito(null);

    const passo = (t: number) => {
      const k = Math.min(1, (t - t0) / CORSA_MS);
      // Passi espliciti e istantanei: `behavior:'auto'`, perché uno scorrimento
      // animato misurerebbe l'animazione, non il costo del rendering.
      window.scrollTo({ top: partenza + CORSA_PX * k, behavior: 'auto' });
      if (k < 1) {
        corsaRaf.current = window.requestAnimationFrame(passo);
        return;
      }
      const dt = corsa.current.dt;
      corsa.current = { attiva: false, dt: [] };
      corsaRaf.current = 0;
      setInCorsa(false);
      setCorsaEsito({
        p95: percentile(dt, 95),
        max: dt.length > 0 ? Math.max(...dt) : 0,
        fotogrammi: dt.length,
        lunghi: dt.filter(v => v > 50).length,
      });
    };
    corsaRaf.current = window.requestAnimationFrame(passo);
  }, []);

  const azzera = useCallback(() => {
    fotogrammi.current = [];
    lunghi.current = [];
    setCorsaEsito(null);
  }, []);

  const riga = { display: 'flex', justifyContent: 'space-between', gap: '8px' } as const;
  const etichetta = { opacity: 0.55 } as const;
  const bottone = {
    flex: 1,
    padding: '4px 8px',
    borderRadius: '6px',
    border: '1px solid rgba(255,255,255,0.25)',
    background: 'rgba(255,255,255,0.08)',
    color: '#e5e7eb',
    cursor: 'pointer',
    font: 'inherit',
  } as const;

  return (
    <div
      // In basso a sinistra: a destra c'è il pulsante dell'assistente AI.
      className="fixed bottom-3 left-3 z-[400] w-[330px] rounded-lg border border-white/20 bg-black/85 p-3 font-mono text-[11px] leading-relaxed text-gray-200"
      role="status"
      aria-label="Statistiche di scorrimento"
    >
      <div className="mb-1 flex items-center justify-between">
        <span className="font-bold text-gray-100">Scorrimento · finestra 3 s</span>
        <span className="opacity-50">?perf=1</span>
      </div>

      {stat ? (
        <>
          <div style={riga}>
            <span style={etichetta}>fotogrammi</span>
            <span>
              {stat.fps.toFixed(0)}/s · p50 {ms(stat.p50)} · p95 {ms(stat.p95)} · max{' '}
              {ms(stat.max)}
            </span>
          </div>
          <div style={riga}>
            <span style={etichetta}>scatti</span>
            <span>
              &gt;50 ms {stat.lunghi50.toFixed(1)}/s · &gt;100 ms {stat.lunghi100.toFixed(1)}/s
            </span>
          </div>
          <div style={riga}>
            <span style={etichetta}>animazioni</span>
            <span>{stat.animazioni}</span>
          </div>
          <div style={riga}>
            <span style={etichetta}>card / righe</span>
            <span>
              {stat.card} / {stat.righe} ({stat.righeVisibili} visibili)
            </span>
          </div>
          <div style={riga}>
            <span style={etichetta}>immagini</span>
            <span>{stat.img}</span>
          </div>
        </>
      ) : (
        <div className="opacity-60">campionamento…</div>
      )}

      <div style={riga} className="mt-1 border-t border-white/10 pt-1">
        <span style={etichetta}>supporto</span>
        <span>
          content-visibility: {supportaContentVisibility ? 'sì' : 'no'} · longtask:{' '}
          {supportaLongTask ? `${lunghi.current.length} in 3 s` : 'n/d'}
        </span>
      </div>

      <div className="mt-2 flex gap-2">
        <button type="button" style={bottone} onClick={eseguiCorsa} disabled={inCorsa}>
          {inCorsa ? 'corsa…' : `Misura ${CORSA_PX} px`}
        </button>
        <button type="button" style={bottone} onClick={azzera}>
          Azzera
        </button>
      </div>

      <div className="mt-1" style={riga}>
        <span style={etichetta}>ultima corsa</span>
        <span>
          {corsaEsito
            ? `p95 ${ms(corsaEsito.p95)} · max ${ms(corsaEsito.max)} · ${corsaEsito.fotogrammi} fotogrammi, ${corsaEsito.lunghi} scatti`
            : '—'}
        </span>
      </div>
    </div>
  );
};

export default ScrollPerfOverlay;

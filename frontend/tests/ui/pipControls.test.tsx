// @vitest-environment jsdom
/**
 * Controlli della finestra PiP.
 *
 * Le due cose che si rompono in silenzio e che vale la pena fissare qui:
 *
 *  - la timeline deve comparire **solo** dove il seek ha senso (contenuto non
 *    live, durata nota, server che supporta il range). Una barra di posizione
 *    su un canale live, o trascinabile su un server che rifiuta il seek, è una
 *    promessa che l'interfaccia non può mantenere;
 *  - il trascinamento deve emettere **un** seek al rilascio, non uno per pixel
 *    (lo stesso hook della finestra principale esiste per questo).
 *
 * Tutti i controlli inoltre devono essere `no-drag`: la radice della finestra è
 * trascinabile, quindi un pulsante senza `no-drag` sposterebbe la finestra
 * invece di rispondere al click.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({
  state: {
    playing: true,
    muted: false,
    position: 30,
    duration: 300,
    volume: 0.8,
  } as Record<string, unknown>,
  pipState: {
    open: true,
    title: 'Film di prova',
    edgeResize: false,
    isLive: false,
    seekDisabled: false,
    fullscreen: false,
  } as Record<string, unknown>,
  seek: vi.fn(),
  setMuted: vi.fn(),
  setVolume: vi.fn(),
  play: vi.fn(),
  pause: vi.fn(),
  refresh: vi.fn(),
  close: vi.fn(),
  toggleFullscreen: vi.fn(async () => true),
  startResize: vi.fn(),
}));

vi.mock('../../hooks/useMpvCanvasRenderer', () => ({
  useMpvCanvasRenderer: () => ({
    frameCount: 0,
    error: null,
    lastFrameMs: 0,
    hasRenderedFrame: true,
    skippedCount: 0,
  }),
}));

vi.mock('../../hooks/useNativeMpvEngine', () => ({
  useNativeMpvEngine: () => ({
    state: h.state,
    tracks: [],
    hwInfo: null,
    error: null,
    play: h.play,
    pause: h.pause,
    seek: h.seek,
    setVolume: h.setVolume,
    setMuted: h.setMuted,
    refresh: h.refresh,
  }),
}));

vi.mock('../../services/hostBridge', () => ({
  host: {
    pip: {
      state: vi.fn(async () => h.pipState),
      close: h.close,
      toggleFullscreen: h.toggleFullscreen,
      startResize: h.startResize,
    },
    onPipStateChange: () => () => undefined,
  },
}));

import PipWindow from '../../components/PipWindow';

/** jsdom non calcola il layout: senza un rect la timeline avrebbe larghezza 0 e
 *  ogni seek finirebbe a 0 secondi (cioè il test non proverebbe la posizione). */
const stubRect = (el: HTMLElement, width = 100) => {
  Object.defineProperty(el, 'getBoundingClientRect', {
    value: () =>
      ({ left: 0, top: 0, right: width, bottom: 10, width, height: 10, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect,
  });
};

/**
 * jsdom non implementa PointerEvent: gli eventi si costruiscono da MouseEvent e
 * `pointerId` va assegnato a mano (stessa tecnica di tests/player/scrubbing).
 * Senza `pointerId` l'hook non riconosce il rilascio e non emette alcun seek —
 * il test passerebbe verificando nulla.
 */
const pointerEvent = (type: string, clientX: number, pointerId = 1): MouseEvent => {
  const ev = new MouseEvent(type, { clientX, button: 0, bubbles: true, cancelable: true });
  (ev as MouseEvent & { pointerId: number; pointerType: string }).pointerId = pointerId;
  (ev as MouseEvent & { pointerId: number; pointerType: string }).pointerType = 'mouse';
  return ev;
};

const timeline = (container: HTMLElement): HTMLElement | null =>
  container.querySelector<HTMLElement>('[data-pip-timeline]');

const draggable = (el: Element): string =>
  (el as HTMLElement).style.getPropertyValue('--wails-draggable').trim();

describe('PipWindow — controlli', () => {
  let container: HTMLElement;

  beforeEach(() => {
    vi.clearAllMocks();
    h.state = { playing: true, muted: false, position: 30, duration: 300, volume: 0.8 };
    h.pipState = {
      open: true,
      title: 'Film di prova',
      edgeResize: false,
      isLive: false,
      seekDisabled: false,
      fullscreen: false,
    };
    ({ container } = render(<PipWindow />));
  });

  // La suite non ha cleanup automatico (`globals: false` in vitest.config): senza
  // questo, ogni `render` lascia montata una finestra con il proprio listener
  // sulla tastiera, e un keydown ne attiva uno per istanza.
  afterEach(cleanup);

  it('su un VOD mostra la timeline e cerca alla posizione di rilascio', async () => {
    const bar = await waitFor(() => {
      const el = timeline(container);
      expect(el).not.toBeNull();
      return el!;
    });
    stubRect(bar);

    fireEvent(bar, pointerEvent('pointerdown', 50));
    fireEvent(window, pointerEvent('pointerup', 50));

    // 50% di 300 s: un solo seek, alla posizione finale.
    expect(h.seek).toHaveBeenCalledTimes(1);
    expect(h.seek).toHaveBeenCalledWith(150);
  });

  it('su un canale live non mostra né timeline né salti, e segnala LIVE', async () => {
    h.pipState = { ...h.pipState, isLive: true };
    h.state = { ...h.state, duration: 0 };
    const { container: c } = render(<PipWindow />);

    await waitFor(() => expect(timeline(c)).toBeNull());
    expect(c.textContent).toContain('Live');
    expect(c.querySelector('[aria-label="Indietro 10 secondi"]')).toBeNull();
    expect(c.querySelector('[aria-label="Avanti 10 secondi"]')).toBeNull();
  });

  it('se il server non supporta il seek la timeline resta ma non si trascina', async () => {
    h.pipState = { ...h.pipState, seekDisabled: true };
    const { container: c } = render(<PipWindow />);

    const bar = await waitFor(() => {
      const el = timeline(c);
      expect(el).not.toBeNull();
      return el!;
    });
    stubRect(bar);

    fireEvent(bar, pointerEvent('pointerdown', 50));
    fireEvent(window, pointerEvent('pointerup', 50));

    expect(h.seek).not.toHaveBeenCalled();
  });

  it('il pulsante fullscreen chiama il backend e l’icona segue lo stato reale', async () => {
    const btn = await waitFor(() => {
      const el = container.querySelector<HTMLElement>('[aria-label="Tutto schermo"]');
      expect(el).not.toBeNull();
      return el!;
    });

    fireEvent.click(btn);
    expect(h.toggleFullscreen).toHaveBeenCalledTimes(1);

    // Stato "a tutto schermo" dal backend: il pulsante deve offrire l'uscita,
    // non un secondo toggle (che sembrerebbe non fare nulla).
    h.pipState = { ...h.pipState, fullscreen: true };
    const { container: c2 } = render(<PipWindow />);
    await waitFor(() => expect(c2.querySelector('[aria-label="Esci da tutto schermo"]')).not.toBeNull());
  });

  it('le frecce cercano di 10 secondi e F attiva il fullscreen', async () => {
    await waitFor(() => expect(timeline(container)).not.toBeNull());

    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(h.seek).toHaveBeenCalledWith(40); // 30 + 10

    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(h.seek).toHaveBeenCalledWith(20); // 30 - 10

    fireEvent.keyDown(window, { key: 'f' });
    expect(h.toggleFullscreen).toHaveBeenCalledTimes(1);
  });

  it('Esc chiude il PiP, ma in fullscreen esce prima dal fullscreen', async () => {
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(h.close).toHaveBeenCalledTimes(1);

    h.pipState = { ...h.pipState, fullscreen: true };
    const { container: c2 } = render(<PipWindow />);
    await waitFor(() => expect(c2.querySelector('[aria-label="Esci da tutto schermo"]')).not.toBeNull());

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(h.toggleFullscreen).toHaveBeenCalled();
  });

  it('ogni controllo disattiva il trascinamento della finestra', async () => {
    await waitFor(() => expect(timeline(container)).not.toBeNull());

    const controls = container.querySelectorAll('button, input, [data-pip-timeline]');
    expect(controls.length).toBeGreaterThanOrEqual(6); // timeline, salti, play, mute, volume, fullscreen, chiudi
    for (const el of Array.from(controls)) {
      expect(draggable(el)).toBe('no-drag');
    }
  });
});

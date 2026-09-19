// @vitest-environment jsdom
/**
 * Contratto di interazione con la finestra PiP: trascinamento e ridimensionamento.
 *
 * La finestra è frameless, quindi:
 *  - si sposta solo dove Wails riconosce `--wails-draggable: drag` (su GTK3 →
 *    `gtk_window_begin_move_drag`);
 *  - si ridimensiona solo grazie alle maniglie della vista, perché il runtime JS
 *    di Wails attiva il resize dai bordi **solo su Windows**
 *    (`drag.js`: `if (!resizable || !IsWindows()) return`).
 *
 * Il runtime legge `getComputedStyle(elemento sotto il mouse)` e le custom
 * property si ereditano: marcare la radice rende trascinabile tutto il
 * riquadro, e `no-drag` su pulsanti e maniglie protegge le loro aree.
 *
 * Serve un test perché nulla di tutto ciò è verificabile a schermo in CI.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';

// Il componente parla con il backend e con il renderer WebGL: qui interessa
// solo il markup, quindi entrambi sono neutralizzati.
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
    state: { playing: true, muted: false },
    tracks: [],
    hwInfo: null,
    error: null,
    play: vi.fn(),
    pause: vi.fn(),
    setMuted: vi.fn(),
    refresh: vi.fn(),
  }),
}));

vi.mock('../../services/hostBridge', () => ({
  host: {
    pip: {
      state: vi.fn(async () => ({ open: true, title: 'Canale di prova', edgeResize: true })),
      startResize: vi.fn(async () => undefined),
    },
    onPipStateChange: () => () => undefined,
  },
}));

import PipWindow from '../../components/PipWindow';
import { host } from '../../services/hostBridge';

const draggable = (el: Element | null): string =>
  el ? (el as HTMLElement).style.getPropertyValue('--wails-draggable').trim() : '';

const allHandles = (container: HTMLElement): HTMLElement[] =>
  Array.from(container.querySelectorAll<HTMLElement>('[data-resize-edge]'));

describe('PipWindow — spostamento e ridimensionamento', () => {
  let container: HTMLElement;

  beforeEach(() => {
    vi.clearAllMocks();
    ({ container } = render(<PipWindow />));
  });

  it('tutta la radice è trascinabile, non solo la barra del titolo', () => {
    const root = container.firstElementChild;
    expect(root).not.toBeNull();
    expect(draggable(root)).toBe('drag');
  });

  it('il canvas eredita il trascinamento (nessun no-drag esplicito)', () => {
    const canvas = container.querySelector('canvas');
    expect(canvas).not.toBeNull();
    expect(draggable(canvas)).toBe('');
  });

  it('ogni pulsante disattiva il trascinamento, altrimenti non sarebbe cliccabile', () => {
    const buttons = Array.from(container.querySelectorAll('button'));
    expect(buttons.length).toBeGreaterThanOrEqual(3); // chiudi, play/pausa, mute
    for (const b of buttons) {
      expect(draggable(b)).toBe('no-drag');
    }
  });

  it('presenta una maniglia per ogni bordo e angolo, tutte no-drag', async () => {
    const handles = await waitFor(() => {
      const els = allHandles(container);
      expect(els.length).toBe(8);
      return els;
    });
    for (const h of handles) {
      expect(draggable(h)).toBe('no-drag');
    }
    const edges = handles.map((h) => h.dataset.resizeEdge);
    for (const expected of ['n-resize', 's-resize', 'e-resize', 'w-resize',
      'ne-resize', 'nw-resize', 'se-resize', 'sw-resize']) {
      expect(edges).toContain(expected);
    }
  });

  // La regressione osservata: le maniglie erano renderizzate PRIMA delle due
  // barre, che quindi le coprivano. La barra del titolo (28 px) rendeva
  // irraggiungibili bordo nord e angoli superiori, i controlli in basso bordo
  // sud e angoli inferiori — incluso l'angolo in basso a destra, il primo che
  // si prende per ridimensionare. Erano usabili solo i due lati verticali.
  it('le maniglie stanno sopra le barre, non sotto', async () => {
    const handles = await waitFor(() => {
      const els = allHandles(container);
      expect(els.length).toBe(8);
      return els;
    });

    const root = container.firstElementChild as HTMLElement;
    const children = Array.from(root.children);
    const firstHandleIndex = children.findIndex((el) => el.hasAttribute('data-resize-edge'));

    expect(firstHandleIndex).toBeGreaterThan(-1);
    // Dopo la prima maniglia non deve esserci nessun altro elemento: se una
    // barra tornasse in coda, la coprirebbe di nuovo.
    expect(children.slice(firstHandleIndex).every((el) => el.hasAttribute('data-resize-edge'))).toBe(true);
    for (const h of handles) {
      expect(h.className).toContain('z-20');
    }
  });

  it('il mousedown su una maniglia chiede al backend il resize di quel bordo', async () => {
    const handle = await waitFor(() => {
      const el = container.querySelector<HTMLElement>('[data-resize-edge="se-resize"]');
      expect(el).not.toBeNull();
      return el!;
    });

    fireEvent.mouseDown(handle, { button: 0 });

    expect(host.pip.startResize).toHaveBeenCalledWith('se-resize');
  });
});

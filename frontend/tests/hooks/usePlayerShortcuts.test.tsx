// @vitest-environment jsdom
/**
 * Mappa completa delle scorciatoie del player.
 *
 * Fino a ora nessun test asseriva l'insieme documentato in `AGENTS.md`
 * (Spazio/Invio, P, frecce, M, F, C, L, S, T, G, Esc): una scorciatoia poteva
 * sparire o cambiare significato senza che nulla protestasse.
 *
 * Serve anche da guardia su un bug reale: `f` è gestito QUI (e non da `App.tsx`)
 * quando il player è aperto, perché entrambi i listener stanno su `window` in
 * fase bubble e scattano comunque. Se questo hook smettesse di gestire `f`, la
 * guardia in `App.tsx` diventerebbe un vicolo cieco e il tasto non farebbe più
 * nulla durante la riproduzione.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';
import type { Channel } from '../../types.ts';
import {
  usePlayerShortcuts,
  type UsePlayerShortcutsHandlers,
  type UsePlayerShortcutsContext,
} from '../../hooks/usePlayerShortcuts.ts';

const liveChannel = { id: 'c1', name: 'Canale', type: 'live' } as Channel;
const movieChannel = { id: 'm1', name: 'Film', type: 'movie' } as Channel;

const makeHandlers = (overrides: Partial<UsePlayerShortcutsHandlers> = {}): UsePlayerShortcutsHandlers => ({
  togglePlay: vi.fn(),
  togglePip: vi.fn(),
  skip: vi.fn(),
  setVolume: vi.fn(),
  currentVolume: 0.5,
  toggleMute: vi.fn(),
  toggleFullscreen: vi.fn(),
  openCast: vi.fn(),
  togglePlaylist: vi.fn(),
  onEscape: vi.fn(),
  toggleEpg: vi.fn(),
  toggleSleepTimer: vi.fn(),
  toggleSubtitles: vi.fn(),
  ...overrides,
});

const mount = (
  handlers: UsePlayerShortcutsHandlers,
  ctx: UsePlayerShortcutsContext = { channel: liveChannel },
) => renderHook(() => usePlayerShortcuts(handlers, ctx));

const press = (key: string, init: KeyboardEventInit = {}) => {
  const event = new KeyboardEvent('keydown', { key, cancelable: true, bubbles: true, ...init });
  window.dispatchEvent(event);
  return event;
};

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

describe('usePlayerShortcuts — mappa documentata', () => {
  it('Spazio e Invio commutano play/pausa', () => {
    const h = makeHandlers();
    mount(h);
    press(' ');
    press('Enter');
    expect(h.togglePlay).toHaveBeenCalledTimes(2);
  });

  it('P commuta il PiP e NON il play/pausa', () => {
    const h = makeHandlers();
    mount(h);
    press('p');
    expect(h.togglePip).toHaveBeenCalledTimes(1);
    expect(h.togglePlay).not.toHaveBeenCalled();
  });

  it('senza handler PiP il tasto P resta senza effetto (niente fallback su play/pausa)', () => {
    const h = makeHandlers({ togglePip: undefined });
    mount(h);
    press('p');
    expect(h.togglePlay).not.toHaveBeenCalled();
  });

  it('frecce: seek ±10s e volume ±0.1, con i limiti del volume', () => {
    const h = makeHandlers();
    mount(h);
    press('ArrowLeft');
    press('ArrowRight');
    expect(h.skip).toHaveBeenNthCalledWith(1, -10);
    expect(h.skip).toHaveBeenNthCalledWith(2, 10);

    press('ArrowUp');
    press('ArrowDown');
    expect(h.setVolume).toHaveBeenNthCalledWith(1, 0.6);
    expect(h.setVolume).toHaveBeenNthCalledWith(2, 0.4);
  });

  it('con seekDisabled le frecce laterali non cercano (URG-1 L3)', () => {
    const h = makeHandlers();
    mount(h, { channel: liveChannel, seekDisabled: true });
    press('ArrowLeft');
    press('ArrowRight');
    expect(h.skip).not.toHaveBeenCalled();
  });

  it('M muta, F fullscreen, C apre il cast', () => {
    const h = makeHandlers();
    mount(h);
    press('m');
    press('f');
    press('c');
    expect(h.toggleMute).toHaveBeenCalledTimes(1);
    expect(h.toggleFullscreen).toHaveBeenCalledTimes(1);
    expect(h.openCast).toHaveBeenCalledTimes(1);
  });

  it('L apre la playlist solo per live e serie', () => {
    const live = makeHandlers();
    mount(live);
    press('l');
    expect(live.togglePlaylist).toHaveBeenCalledTimes(1);
    cleanup();

    const movie = makeHandlers();
    mount(movie, { channel: movieChannel });
    press('l');
    expect(movie.togglePlaylist).not.toHaveBeenCalled();
  });

  it('G apre il mini-EPG solo per i canali live', () => {
    const live = makeHandlers();
    mount(live);
    press('g');
    expect(live.toggleEpg).toHaveBeenCalledTimes(1);
    cleanup();

    const movie = makeHandlers();
    mount(movie, { channel: movieChannel });
    press('g');
    expect(movie.toggleEpg).not.toHaveBeenCalled();
  });

  it('S e T aprono sottotitoli e sleep timer', () => {
    const h = makeHandlers();
    mount(h);
    press('s');
    press('t');
    expect(h.toggleSubtitles).toHaveBeenCalledTimes(1);
    expect(h.toggleSleepTimer).toHaveBeenCalledTimes(1);
  });

  it('Esc invoca onEscape', () => {
    const h = makeHandlers();
    mount(h);
    press('Escape');
    expect(h.onEscape).toHaveBeenCalledTimes(1);
  });

  it('le scorciatoie sono ignorate mentre si scrive in un campo di testo', () => {
    const h = makeHandlers();
    mount(h);
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    press(' ');
    press('f');
    expect(h.togglePlay).not.toHaveBeenCalled();
    expect(h.toggleFullscreen).not.toHaveBeenCalled();
  });

  /**
   * LIMITE NOTO (preesistente, non introdotto dalla guardia di `App.tsx`).
   *
   * Questo hook non filtra i modificatori: `App.tsx` invece li controlla
   * (`!e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey`). Con il player
   * aperto, quindi, `Ctrl+F` (trova nella pagina del webview) commuta il
   * fullscreen e `Ctrl+L`, `Ctrl+C` ecc. ricadono sulle scorciatoie nude.
   * Il test fissa il comportamento attuale perché sia visibile: se si decide di
   * allinearlo ad `App.tsx`, va aggiornato qui.
   */
  it('LIMITE: i modificatori non sono filtrati, quindi Ctrl+F commuta il fullscreen', () => {
    const h = makeHandlers();
    mount(h);
    press('f', { ctrlKey: true });
    expect(h.toggleFullscreen).toHaveBeenCalledTimes(1);
  });
});

/**
 * Calcolo della finestra di elementi visibili nelle righe del catalogo.
 *
 * È l'unica parte della virtualizzazione verificabile senza un browser vero
 * (jsdom non calcola il layout), ed è anche quella dove un errore si vede
 * subito: indici troppo stretti lasciano buchi nella riga mentre si scorre,
 * troppo larghi renderizzano copertine che nessuno guarda.
 */
import { describe, expect, it } from 'vitest';
import { isUsableViewportWidth, virtualWindow } from '../../services/virtualWindow.ts';

const EXTENT = 180; // larghezza di una card, ~196 con il poster e ~176 senza
const VIEWPORT = 1200; // ~6-7 card visibili
const OVERSCAN = 8;

describe('virtualWindow', () => {
  it('senza virtualizzazione renderizza tutto', () => {
    expect(virtualWindow(0, VIEWPORT, EXTENT, 20, OVERSCAN, false)).toEqual({ start: 0, end: 20 });
    // Anche a metà scorrimento: con pochi elementi non si taglia nulla.
    expect(virtualWindow(5000, VIEWPORT, EXTENT, 20, OVERSCAN, false)).toEqual({ start: 0, end: 20 });
  });

  it('a inizio riga include l’overscan iniziale ma non va sotto zero', () => {
    expect(virtualWindow(0, VIEWPORT, EXTENT, 100, OVERSCAN, true)).toEqual({ start: 0, end: 15 });
  });

  it('scorrendo centra la finestra sugli elementi visibili', () => {
    // 1800 px = 10 card oltre il bordo sinistro, ~6 visibili → 10..16, più overscan.
    const { start, end } = virtualWindow(1800, VIEWPORT, EXTENT, 100, OVERSCAN, true);
    expect(start).toBe(2); // 10 - overscan
    expect(end).toBe(25); // 10 + 7 visibili + overscan
    // La finestra deve contenere tutto ciò che si vede davvero.
    const primoVisibile = Math.floor(1800 / EXTENT);
    const ultimoVisibile = Math.ceil((1800 + VIEWPORT) / EXTENT) - 1;
    expect(start).toBeLessThanOrEqual(primoVisibile);
    expect(end).toBeGreaterThan(ultimoVisibile);
  });

  it('a fine riga non supera il numero di elementi', () => {
    const total = 20;
    const { end } = virtualWindow(100000, VIEWPORT, EXTENT, total, OVERSCAN, true);
    expect(end).toBe(total);
  });

  it('una riga vuota non produce una finestra negativa', () => {
    expect(virtualWindow(0, VIEWPORT, EXTENT, 0, OVERSCAN, true)).toEqual({ start: 0, end: 0 });
  });

  it('la finestra cresce con l’overscan, mai si restringe', () => {
    const stretto = virtualWindow(1800, VIEWPORT, EXTENT, 200, 2, true);
    const largo = virtualWindow(1800, VIEWPORT, EXTENT, 200, 10, true);
    expect(largo.start).toBeLessThanOrEqual(stretto.start);
    expect(largo.end).toBeGreaterThanOrEqual(stretto.end);
  });
});

/**
 * La larghezza misurata può arrivare **zero** senza che nulla sia rotto: le
 * righe fuori schermo sono saltate dal rendering (`content-visibility: auto`) e
 * una lettura di layout dentro un sottoalbero saltato può tornare 0 prima che
 * il browser lo ridisegni. Con 0 la finestra collasserebbe a una decina di
 * elementi e la riga lampeggerebbe smontando e rimontando le card: meglio
 * tenere l'ultima misura buona.
 */
describe('isUsableViewportWidth', () => {
  it('accetta solo larghezze positive e finite', () => {
    expect(isUsableViewportWidth(1200)).toBe(true);
    expect(isUsableViewportWidth(1)).toBe(true);
    expect(isUsableViewportWidth(0)).toBe(false);
    expect(isUsableViewportWidth(-1)).toBe(false);
    expect(isUsableViewportWidth(Number.NaN)).toBe(false);
    expect(isUsableViewportWidth(Number.POSITIVE_INFINITY)).toBe(false);
  });
});

// @vitest-environment jsdom
/**
 * Guard di regressione: il contesto WebGL NON deve essere perso quando
 * l'effect del renderer si ri-esegue per un cambio di stato.
 *
 * Il caso reale (2026-09-19): aprendo il PiP, `enabled` diventava false e la
 * cleanup dell'effect chiamava `WEBGL_lose_context.loseContext()`. Alla
 * chiusura del PiP l'effect ripartiva, ma `canvas.getContext('webgl2')`
 * restituiva lo STESSO contesto, ormai morto (per specifica un canvas conserva
 * il proprio contesto e dopo `loseContext()` le chiamate GL vengono ignorate
 * in silenzio): il video non riprendeva più nella finestra principale.
 *
 * Il PiP non era coinvolto: funzionava perché è un documento separato, con
 * canvas e contesto propri. Da qui la difficoltà di attribuire il sintomo.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useMpvCanvasRenderer } from '../../hooks/useMpvCanvasRenderer';

/** Contesto WebGL2 finto: registra `loseContext` e conta le acquisizioni. */
function makeFakeGl(loseContext: () => void) {
  const target: Record<string, unknown> = {
    createShader: () => ({}),
    createProgram: () => ({}),
    createBuffer: () => ({}),
    createTexture: () => ({}),
    getAttribLocation: () => 0,
    getUniformLocation: () => ({}),
    getAttachedShaders: () => [],
    getShaderParameter: () => true,
    getProgramParameter: () => true,
    getExtension: (name: string) =>
      name === 'WEBGL_lose_context' ? { loseContext, restoreContext: () => undefined } : null,
  };
  // Qualunque altra chiamata GL è un no-op: al test interessa solo che il
  // contesto resti vivo attraverso i toggle di stato.
  return new Proxy(target, {
    get(t, prop) {
      if (prop in t) return t[prop as string];
      return () => undefined;
    },
  });
}

describe('useMpvCanvasRenderer — il canvas sopravvive ai toggle di stato', () => {
  let loseContext: ReturnType<typeof vi.fn>;
  let getContext: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers(); // il loop non parte: qui si testa solo il ciclo di vita dell'effect
    loseContext = vi.fn();
    getContext = vi.fn(() => makeFakeGl(loseContext));
    HTMLCanvasElement.prototype.getContext = getContext as unknown as typeof HTMLCanvasElement.prototype.getContext;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('non perde il contesto quando enabled passa false→true (apertura/chiusura PiP)', () => {
    const canvas = document.createElement('canvas');
    const canvasRef = { current: canvas };

    const { rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useMpvCanvasRenderer(canvasRef, enabled, {}),
      { initialProps: { enabled: true } },
    );

    expect(getContext).toHaveBeenCalledTimes(1);

    // Apertura del PiP: il renderer principale si disabilita.
    rerender({ enabled: false });

    // Chiusura del PiP: deve ripartire.
    rerender({ enabled: true });

    expect(loseContext).not.toHaveBeenCalled();
    // Il contesto viene riacquisito al riavvio: se il canvas fosse stato
    // "ucciso", questa chiamata restituirebbe il contesto morto.
    expect(getContext.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('non perde il contesto nemmeno al cambio di targetFPS', () => {
    const canvas = document.createElement('canvas');
    const canvasRef = { current: canvas };

    const { rerender } = renderHook(
      ({ fps }: { fps: number }) => useMpvCanvasRenderer(canvasRef, true, { targetFPS: fps }),
      { initialProps: { fps: 30 } },
    );
    rerender({ fps: 15 });

    expect(loseContext).not.toHaveBeenCalled();
  });
});

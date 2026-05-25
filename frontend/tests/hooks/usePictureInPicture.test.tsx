// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRef } from 'react';
import {
  usePictureInPicture,
  hasDocumentPipApi,
  hasVideoPipApi,
} from '../../hooks/usePictureInPicture';

/**
 * Unit test del hook `usePictureInPicture` (Fase 6.2 plan-go-wails-migration).
 *
 * Note jsdom:
 *   - jsdom non implementa l'API PiP nativa. Mockiamo manualmente
 *     `document.pictureInPictureEnabled`, `document.exitPictureInPicture`,
 *     `HTMLVideoElement.prototype.requestPictureInPicture` per simulare
 *     i tre runtime (WebKitGTK 6.0, WebView2, WKWebView).
 *   - Gli eventi `enterpictureinpicture` / `leavepictureinpicture` sono
 *     `Event` standard dispatchabili — jsdom li propaga normalmente.
 */

function mockVideoPipApi(opts: { enabled: boolean }) {
  Object.defineProperty(document, 'pictureInPictureEnabled', {
    configurable: true,
    get: () => opts.enabled,
  });
  Object.defineProperty(document, 'pictureInPictureElement', {
    configurable: true,
    writable: true,
    value: null,
  });
  Object.defineProperty(document, 'exitPictureInPicture', {
    configurable: true,
    writable: true,
    value: vi.fn().mockImplementation(async () => {
      (document as any).pictureInPictureElement = null;
    }),
  });
  Object.defineProperty(HTMLVideoElement.prototype, 'requestPictureInPicture', {
    configurable: true,
    writable: true,
    value: vi.fn().mockImplementation(async function (this: HTMLVideoElement) {
      (document as any).pictureInPictureElement = this;
      // Simula l'evento DOM standard.
      this.dispatchEvent(new Event('enterpictureinpicture'));
      return {};
    }),
  });
}

function clearVideoPipApi() {
  Object.defineProperty(document, 'pictureInPictureEnabled', {
    configurable: true,
    get: () => false,
  });
  Object.defineProperty(document, 'pictureInPictureElement', {
    configurable: true,
    writable: true,
    value: null,
  });
  // jsdom standard non ha questi metodi: ripristiniamo undefined.
  delete (document as any).exitPictureInPicture;
  delete (HTMLVideoElement.prototype as any).requestPictureInPicture;
}

describe('usePictureInPicture — feature detection', () => {
  it('hasDocumentPipApi returns false on jsdom (no window.documentPictureInPicture)', () => {
    expect(hasDocumentPipApi()).toBe(false);
  });

  it('hasVideoPipApi reflects document.pictureInPictureEnabled', () => {
    mockVideoPipApi({ enabled: true });
    expect(hasVideoPipApi()).toBe(true);
    clearVideoPipApi();
    expect(hasVideoPipApi()).toBe(false);
  });
});

describe('usePictureInPicture — toggle flow', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    mockVideoPipApi({ enabled: true });
  });

  afterEach(() => {
    clearVideoPipApi();
  });

  it('reports supported=true when video PiP API is available', () => {
    const { result } = renderHook(() => usePictureInPicture({ videoRef: { current: null } }));
    expect(result.current.supported).toBe(true);
    expect(result.current.isPip).toBe(false);
  });

  it('enter() calls video.requestPictureInPicture and flips isPip', async () => {
    const video = document.createElement('video');
    document.body.appendChild(video);

    const { result, rerender } = renderHook(
      ({ ref }) => usePictureInPicture({ videoRef: ref }),
      { initialProps: { ref: { current: video } as React.RefObject<HTMLVideoElement | null> } },
    );
    rerender({ ref: { current: video } as React.RefObject<HTMLVideoElement | null> });

    await act(async () => {
      const ok = await result.current.enter();
      expect(ok).toBe(true);
    });

    expect(video.requestPictureInPicture).toHaveBeenCalled();
    expect(result.current.isPip).toBe(true);
  });

  it('toggle() exits when already in PiP', async () => {
    const video = document.createElement('video');
    document.body.appendChild(video);
    (document as any).pictureInPictureElement = video;

    const { result } = renderHook(() =>
      usePictureInPicture({ videoRef: { current: video } as React.RefObject<HTMLVideoElement | null> }),
    );

    await act(async () => {
      const ok = await result.current.toggle();
      expect(ok).toBe(true);
    });

    expect(document.exitPictureInPicture).toHaveBeenCalled();
  });

  it('invokes onChange callback when leavepictureinpicture fires', async () => {
    const video = document.createElement('video');
    document.body.appendChild(video);
    const onChange = vi.fn();

    renderHook(() =>
      usePictureInPicture({
        videoRef: { current: video } as React.RefObject<HTMLVideoElement | null>,
        onChange,
      }),
    );

    await act(async () => {
      video.dispatchEvent(new Event('enterpictureinpicture'));
    });
    expect(onChange).toHaveBeenCalledWith(true);

    await act(async () => {
      video.dispatchEvent(new Event('leavepictureinpicture'));
    });
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it('enter() calls onUnsupported when videoRef.current is null', async () => {
    const onUnsupported = vi.fn();
    const { result } = renderHook(() =>
      usePictureInPicture({
        videoRef: { current: null } as React.RefObject<HTMLVideoElement | null>,
        onUnsupported,
      }),
    );

    await act(async () => {
      const ok = await result.current.enter();
      expect(ok).toBe(false);
    });
    expect(onUnsupported).toHaveBeenCalled();
  });
});

describe('usePictureInPicture — no PiP runtime', () => {
  beforeEach(() => {
    clearVideoPipApi();
  });

  it('reports supported=false when no PiP API is available', () => {
    const { result } = renderHook(() => usePictureInPicture());
    expect(result.current.supported).toBe(false);
  });

  it('enter() calls onUnsupported gracefully', async () => {
    const video = document.createElement('video');
    const onUnsupported = vi.fn();
    const { result } = renderHook(() =>
      usePictureInPicture({
        videoRef: { current: video } as React.RefObject<HTMLVideoElement | null>,
        onUnsupported,
      }),
    );

    await act(async () => {
      const ok = await result.current.enter();
      expect(ok).toBe(false);
    });
    expect(onUnsupported).toHaveBeenCalled();
  });
});

describe('usePictureInPicture — ref type compatibility', () => {
  it('accepts useRef<HTMLVideoElement>(null) without TS error', () => {
    const { result } = renderHook(() => {
      const ref = useRef<HTMLVideoElement>(null);
      return usePictureInPicture({ videoRef: ref });
    });
    expect(typeof result.current.toggle).toBe('function');
  });
});


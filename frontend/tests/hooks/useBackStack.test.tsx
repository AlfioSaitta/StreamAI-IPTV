// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useBackStack } from '../../hooks/useBackStack';

// Capacitor App is stubbed so the Android-only branch is a no-op in jsdom.
vi.mock('@capacitor/app', () => ({
  App: {
    addListener: vi.fn(async () => ({ remove: vi.fn() })),
    exitApp: vi.fn(),
  },
}));

vi.mock('../../services/platformService.ts', () => ({
  platformService: { isNative: false, isWails: false, isDesktop: false, isAndroid: false, isWeb: true, init: vi.fn() },
}));

function dispatchEsc() {
  // Programmatically dispatch a KeyboardEvent with `key: 'Escape'`.
  // We can't rely on .preventDefault tracking in jsdom, so wrap the
  // dispatch and inspect via spying on event.preventDefault.
  const ev = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
  window.dispatchEvent(ev);
  return ev;
}

describe('useBackStack', () => {
  beforeEach(() => {
    // Reset focused element so the input-check guard doesn't kick in.
    document.body.innerHTML = '';
  });
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('closes the topmost open layer on Esc', () => {
    const onCloseA = vi.fn();
    const onCloseB = vi.fn();
    renderHook(() =>
      useBackStack([
        { id: 'a', isOpen: true, onClose: onCloseA },
        { id: 'b', isOpen: true, onClose: onCloseB },
      ])
    );

    act(() => { dispatchEsc(); });
    expect(onCloseA).toHaveBeenCalledTimes(1);
    expect(onCloseB).not.toHaveBeenCalled();
  });

  it('skips layers marked skipEsc and stops the chain', () => {
    const onClosePlayer = vi.fn();
    const onCloseModal = vi.fn();
    renderHook(() =>
      useBackStack([
        { id: 'player', isOpen: true, onClose: onClosePlayer, skipEsc: true },
        { id: 'modal', isOpen: true, onClose: onCloseModal },
      ])
    );

    act(() => { dispatchEsc(); });
    // Player swallows Esc (skipEsc) but DOES NOT close. Chain stops there.
    expect(onClosePlayer).not.toHaveBeenCalled();
    expect(onCloseModal).not.toHaveBeenCalled();
  });

  it('calls onEmpty when no layer is open (Esc no-op, but manual back invokes it)', () => {
    const onEmpty = vi.fn();
    const { result } = renderHook(() =>
      useBackStack([{ id: 'a', isOpen: false, onClose: vi.fn() }], { onEmpty })
    );
    act(() => { result.current.back('manual'); });
    expect(onEmpty).toHaveBeenCalledTimes(1);
  });

  it('manual back closes a skipEsc layer (Android Back button parity)', () => {
    const onClose = vi.fn();
    const { result } = renderHook(() =>
      useBackStack([{ id: 'player', isOpen: true, onClose, skipEsc: true }])
    );
    act(() => { result.current.back('androidBack'); });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('topId / openIds reflect the open layers top-down', () => {
    const { result } = renderHook(() =>
      useBackStack([
        { id: 'player', isOpen: false, onClose: vi.fn() },
        { id: 'modal', isOpen: true, onClose: vi.fn() },
        { id: 'tab', isOpen: true, onClose: vi.fn() },
      ])
    );
    expect(result.current.topId).toBe('modal');
    expect(result.current.openIds).toEqual(['modal', 'tab']);
  });

  it('ignores Esc while typing in an input', () => {
    const onClose = vi.fn();
    renderHook(() =>
      useBackStack([{ id: 'modal', isOpen: true, onClose }])
    );

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    act(() => { dispatchEsc(); });
    expect(onClose).not.toHaveBeenCalled();
  });
});


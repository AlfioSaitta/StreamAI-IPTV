// @vitest-environment jsdom
// C.1 (2026-05-15) — Test smoke per la modalità onboarding di
// ShortcutsCheatsheet: visibilità della checkbox "Non mostrare più",
// invocazione di onDontShowAgain alla chiusura, niente checkbox in
// modalità manuale (apertura via `?` / `Shift+/`).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import ShortcutsCheatsheet from '../../components/ShortcutsCheatsheet';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe('ShortcutsCheatsheet onboarding mode (C.1)', () => {
  it('non mostra la checkbox "Non mostrare più" in modalità manuale (default)', () => {
    render(<ShortcutsCheatsheet isOpen onClose={() => {}} />);
    expect(screen.queryByLabelText(/Non mostrare più/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /ho capito/i })).toBeNull();
  });

  it('mostra checkbox + CTA "Ho capito" quando showDontShowAgain=true', () => {
    render(<ShortcutsCheatsheet isOpen onClose={() => {}} showDontShowAgain />);
    expect(screen.getByLabelText(/Non mostrare più/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /ho capito/i })).toBeTruthy();
  });

  it('chiamando "Ho capito" senza spunta invoca onClose ma NON onDontShowAgain', () => {
    const onClose = vi.fn();
    const onDontShowAgain = vi.fn();
    render(
      <ShortcutsCheatsheet
        isOpen
        onClose={onClose}
        onDontShowAgain={onDontShowAgain}
        showDontShowAgain
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /ho capito/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onDontShowAgain).not.toHaveBeenCalled();
  });

  it('chiamando "Ho capito" con checkbox spuntata invoca anche onDontShowAgain', () => {
    const onClose = vi.fn();
    const onDontShowAgain = vi.fn();
    render(
      <ShortcutsCheatsheet
        isOpen
        onClose={onClose}
        onDontShowAgain={onDontShowAgain}
        showDontShowAgain
      />,
    );
    const checkbox = screen.getByLabelText(/Non mostrare più/i) as HTMLInputElement;
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /ho capito/i }));
    expect(onDontShowAgain).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Esc chiude e rispetta lo stato della checkbox', () => {
    const onClose = vi.fn();
    const onDontShowAgain = vi.fn();
    render(
      <ShortcutsCheatsheet
        isOpen
        onClose={onClose}
        onDontShowAgain={onDontShowAgain}
        showDontShowAgain
      />,
    );
    const checkbox = screen.getByLabelText(/Non mostrare più/i) as HTMLInputElement;
    fireEvent.click(checkbox);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onDontShowAgain).toHaveBeenCalledTimes(1);
  });
});


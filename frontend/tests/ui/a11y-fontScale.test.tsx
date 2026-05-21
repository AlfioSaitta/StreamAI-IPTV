// @vitest-environment jsdom
// C.6 (2026-05-15) — Accessibilità: smoke test per la scala font.
//
// 1) DEFAULT_PREFERENCES espone `fontScale: 'md'` (regression).
// 2) Il Select "Dimensione testo" in ProfileSettings cambia la preferenza.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DEFAULT_PREFERENCES } from '../../services/profileService';
import ProfileSettings from '../../components/ProfileSettings';
import type { Profile } from '../../types';

beforeEach(() => {
  // ProfileSettings consulta localStorage indirettamente tramite CacheService;
  // mockiamo solo i metodi necessari per evitare crash di setup.
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('C.6 — fontScale preference', () => {
  it('DEFAULT_PREFERENCES.fontScale === "md"', () => {
    expect(DEFAULT_PREFERENCES.fontScale).toBe('md');
  });

  it('ProfileSettings mostra il selettore "Dimensione testo" con il valore del profilo', () => {
    const profile: Profile = {
      id: 'p1',
      name: 'Test',
      color: '#8b5cf6',
      xtreamCreds: null,
      history: [],
      watchlist: [],
      preferences: { ...DEFAULT_PREFERENCES, fontScale: 'lg' },
    };
    render(
      <ProfileSettings
        profile={profile}
        onBack={() => {}}
        onProfileUpdate={() => {}}
      />,
    );
    const select = screen.getByLabelText(/Dimensione testo/i) as HTMLSelectElement;
    expect(select).toBeTruthy();
    expect(select.value).toBe('lg');
  });

  it('aggiornamento select riflette il nuovo valore nello state locale', () => {
    const profile: Profile = {
      id: 'p1',
      name: 'Test',
      color: '#8b5cf6',
      xtreamCreds: null,
      history: [],
      watchlist: [],
      preferences: { ...DEFAULT_PREFERENCES, fontScale: 'md' },
    };
    render(
      <ProfileSettings
        profile={profile}
        onBack={() => {}}
        onProfileUpdate={() => {}}
      />,
    );
    const select = screen.getByLabelText(/Dimensione testo/i) as HTMLSelectElement;
    expect(select.value).toBe('md');
    fireEvent.change(select, { target: { value: 'xl' } });
    expect(select.value).toBe('xl');
  });
});


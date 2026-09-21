// @vitest-environment jsdom
/**
 * Impostazioni profilo: il salvataggio non deve annullare gli aggiornamenti
 * fatti in background.
 *
 * Il sintomo: `App.tsx` aggiorna `contentLastRefreshAt`/`contentLastRefreshError`
 * nel profilo dopo ogni refresh del catalogo (auto-refresh compreso) e chiama
 * `setActiveProfile`, quindi `ProfileSettings` riceve un prop `profile` nuovo —
 * ma il suo stato locale `preferences` era idratato una volta sola. Al salvataggio
 * il componente inviava l'INTERO oggetto locale, e `ProfileService.updatePreferences`
 * fa un merge sui valori persistiti: il timestamp appena aggiornato veniva
 * riportato al valore vecchio. Il salvataggio sembrava riuscito.
 *
 * Qui si fissano le due proprietà che lo impediscono:
 *  1. si inviano solo le chiavi effettivamente modificate dall'utente;
 *  2. un aggiornamento in background non sovrascrive una modifica non salvata.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Profile, ProfilePreferences } from '../../types.ts';

const h = vi.hoisted(() => ({
  updatePreferences: vi.fn(),
  updateProfile: vi.fn(),
}));

// `DEFAULT_PREFERENCES` resta quello vero (il componente lo usa per completare
// le preferenze mancanti); si sostituiscono solo le due scritture, che sono ciò
// che il test deve osservare.
vi.mock('../../services/profileService.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/profileService.ts')>();
  return {
    ...actual,
    ProfileService: {
      ...actual.ProfileService,
      updatePreferences: h.updatePreferences,
      updateProfile: h.updateProfile,
    },
  };
});

// `getStats` interroga Cache API/IndexedDB: non esiste in jsdom e il fallimento
// arriverebbe come rumore di sottofondo che sembra un bug del componente. Il
// mock deve coprire TUTTI i campi che il render legge (in particolare
// `storage.percentUsed`), altrimenti si ottiene lo stesso rumore per un motivo
// diverso.
vi.mock('../../services/cacheService.ts', () => ({
  CacheService: {
    getStats: async () => ({
      totalImages: 0,
      imageBytesMB: '0',
      imageLimitMB: 512,
      imageLimitEntries: 2000,
      imageTtlDays: 30,
      memCacheSize: 0,
      hitRate: 0,
      downloaded: 0,
      failed: 0,
      storage: {
        usageMB: '0',
        quotaGB: '0',
        percentUsed: 0,
        persistent: false,
      },
    }),
    clearApiByPrefix: async () => 0,
    cleanupOldImages: async () => ({ removed: 0, freedBytes: 0 }),
    clearImages: async () => undefined,
    clearAll: async () => undefined,
  },
}));

vi.mock('../../services/tmdbEnricher.ts', () => ({
  TmdbEnricherService: {
    isEnriching: () => false,
    startBackgroundEnrichment: vi.fn(),
  },
}));

// Il focus spaziale aggiunge listener globali: qui interessa solo il salvataggio.
vi.mock('../../hooks/useTvFocus.ts', () => ({
  useInitialTvFocus: () => undefined,
  useEscapeKey: () => undefined,
  useTvSpatialNavigation: () => undefined,
}));

vi.mock('../../contexts/LanguageContext.tsx', () => ({
  useLanguage: () => ({
    language: 'it',
    t: {
      saveChanges: 'Salva modifiche',
      profile: 'Profilo',
      profileName: 'Nome profilo',
      appearance: 'Aspetto',
      playback: 'Riproduzione',
      languageAndSubtitles: 'Lingua e sottotitoli',
      aiCaching: 'Cache risposte AI',
      debugOverlay: 'Overlay di debug',
      clearCache: 'Svuota cache',
      back: 'Indietro',
    },
  }),
}));

import ProfileSettings from '../../components/ProfileSettings.tsx';
import { DEFAULT_PREFERENCES } from '../../services/profileService.ts';

const TS_BASE = 1_700_000_000_000;

/** Profilo con il timestamp di ultimo aggiornamento catalogo indicato. */
const profileWith = (contentLastRefreshAt: number, overrides: Partial<ProfilePreferences> = {}): Profile => ({
  id: 'p1',
  name: 'Alfio',
  color: '#8b5cf6',
  avatar: undefined,
  xtreamCreds: null,
  history: [],
  watchlist: [],
  preferences: {
    ...DEFAULT_PREFERENCES,
    contentLastRefreshAt,
    tmdbEnrichmentEnabled: false,
    ...overrides,
  },
});

const renderSettings = (profile: Profile) => {
  const props = {
    onBack: vi.fn(),
    onProfileUpdate: vi.fn(),
    allChannels: [],
  };
  const view = render(<ProfileSettings {...props} profile={profile} />);
  return { ...view, props };
};

const TMDB_TOGGLE = 'Arricchimento automatico TMDB';
const SAVE_BUTTON = 'Salva modifiche';

beforeEach(() => {
  h.updatePreferences.mockReset();
  h.updateProfile.mockReset();
  // `updatePreferences` fa un merge sui valori persistiti e ritorna il profilo
  // aggiornato: il mock replica quel contratto, altrimenti `onProfileUpdate`
  // non verrebbe chiamato e il componente resterebbe in stato "da salvare".
  h.updatePreferences.mockImplementation((id: string, prefs: Partial<ProfilePreferences>) => ({
    ...profileWith(TS_BASE),
    id,
    preferences: { ...DEFAULT_PREFERENCES, ...prefs },
  }));
});

afterEach(() => {
  cleanup();
});

describe('ProfileSettings — salvataggio e aggiornamenti in background', () => {
  it('invia solo le preferenze modificate, senza riportare indietro contentLastRefreshAt', async () => {
    const { rerender } = renderSettings(profileWith(TS_BASE));

    // Refresh riuscito in background: App.tsx persiste il nuovo timestamp e
    // passa un profilo nuovo a questo componente.
    rerender(<ProfileSettings profile={profileWith(TS_BASE + 60_000)} onBack={vi.fn()} onProfileUpdate={vi.fn()} allChannels={[]} />);

    // L'utente cambia una preferenza non correlata e salva.
    fireEvent.click(screen.getByRole('switch', { name: TMDB_TOGGLE }));
    fireEvent.click(screen.getByRole('button', { name: SAVE_BUTTON }));

    await waitFor(() => expect(h.updatePreferences).toHaveBeenCalledTimes(1));
    const [, payload] = h.updatePreferences.mock.calls[0] as [string, Partial<ProfilePreferences>];

    expect(payload).toEqual({ tmdbEnrichmentEnabled: true });
    // Il cuore della regressione: con l'oggetto intero questo campo tornava a
    // TS_BASE, cancellando il refresh appena registrato.
    expect(payload).not.toHaveProperty('contentLastRefreshAt');
  });

  it('non perde una modifica non salvata quando arriva un aggiornamento in background', async () => {
    const { rerender } = renderSettings(profileWith(TS_BASE));

    // Modifica dell'utente, non ancora salvata.
    fireEvent.click(screen.getByRole('switch', { name: TMDB_TOGGLE }));

    // Nel frattempo il background aggiorna un ALTRO campo.
    rerender(<ProfileSettings profile={profileWith(TS_BASE + 60_000)} onBack={vi.fn()} onProfileUpdate={vi.fn()} allChannels={[]} />);

    fireEvent.click(screen.getByRole('button', { name: SAVE_BUTTON }));

    await waitFor(() => expect(h.updatePreferences).toHaveBeenCalledTimes(1));
    const [, payload] = h.updatePreferences.mock.calls[0] as [string, Partial<ProfilePreferences>];

    // La scelta dell'utente vince; il campo aggiornato in background resta
    // fuori dal payload (lo ha già persistito App.tsx).
    expect(payload).toEqual({ tmdbEnrichmentEnabled: true });
  });

  it('senza modifiche non scrive nulla e il pulsante resta disabilitato', () => {
    renderSettings(profileWith(TS_BASE));

    expect((screen.getByRole('button', { name: SAVE_BUTTON }) as HTMLButtonElement).disabled).toBe(true);
    expect(h.updatePreferences).not.toHaveBeenCalled();
  });
});

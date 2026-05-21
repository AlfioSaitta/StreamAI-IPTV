// @vitest-environment jsdom
// C.2 — Test smoke per OnboardingWizard: navigazione 3 step, validazione
// connessione Xtream e validazione URL M3U remoto.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import OnboardingWizard from '../../components/OnboardingWizard';
import { ProfileService } from '../../services/profileService';

// Mock localStorage in jsdom (jsdom ne fornisce uno, ma resettiamolo).
beforeEach(() => {
  localStorage.clear();
  // Reset fetch mock per ogni test.
  vi.unstubAllGlobals();
});
afterEach(() => cleanup());

describe('OnboardingWizard (C.2)', () => {
  it('blocca "Avanti" finché non viene inserito il nome', () => {
    render(<OnboardingWizard open onClose={() => {}} onComplete={() => {}} />);
    const next = screen.getByRole('button', { name: /avanti/i }) as HTMLButtonElement;
    expect(next.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/nome profilo/i), { target: { value: 'Salotto' } });
    expect((screen.getByRole('button', { name: /avanti/i }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('valida URL M3U: rifiuta URL invalido, accetta payload con #EXTM3U', async () => {
    // Mock fetch: ritorna playlist M3U plausibile.
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      '#EXTM3U\n#EXTINF:-1,Test\nhttp://x/y.ts\n',
      { status: 206, statusText: 'Partial Content' },
    )));

    render(<OnboardingWizard open onClose={() => {}} onComplete={() => {}} />);

    // Step 1 → nome
    fireEvent.change(screen.getByLabelText(/nome profilo/i), { target: { value: 'M3U user' } });
    fireEvent.click(screen.getByRole('button', { name: /avanti/i }));

    // Step 2 → switch a M3U
    fireEvent.click(screen.getByRole('button', { name: /playlist m3u/i }));
    const urlInput = screen.getByLabelText(/url playlist m3u/i);

    // URL invalido → test KO
    fireEvent.change(urlInput, { target: { value: 'not-a-url' } });
    fireEvent.click(screen.getByRole('button', { name: /verifica playlist/i }));
    await waitFor(() => {
      expect(screen.getByText(/url non valido/i)).toBeTruthy();
    });

    // URL valido → test OK
    fireEvent.change(urlInput, { target: { value: 'http://example.test/playlist.m3u' } });
    fireEvent.click(screen.getByRole('button', { name: /verifica playlist/i }));
    await waitFor(() => {
      expect(screen.getByText(/playlist valida/i)).toBeTruthy();
    });
  });

  it('crea profilo con preferenze e playlistUrl al completamento del wizard', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      '#EXTM3U\n#EXTINF:-1,Test\nhttp://x/y.ts\n',
      { status: 200, statusText: 'OK' },
    )));

    const onComplete = vi.fn();
    render(<OnboardingWizard open onClose={() => {}} onComplete={onComplete} />);

    fireEvent.change(screen.getByLabelText(/nome profilo/i), { target: { value: 'Kids' } });
    fireEvent.click(screen.getByRole('button', { name: /avanti/i }));
    fireEvent.click(screen.getByRole('button', { name: /playlist m3u/i }));
    fireEvent.change(screen.getByLabelText(/url playlist m3u/i), {
      target: { value: 'http://example.test/playlist.m3u' },
    });
    fireEvent.click(screen.getByRole('button', { name: /verifica playlist/i }));
    await waitFor(() => expect(screen.getByText(/playlist valida/i)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /avanti/i }));

    // Step 3 → lingua + finish
    const langSelect = screen.getByLabelText(/lingua interfaccia/i) as HTMLSelectElement;
    fireEvent.change(langSelect, { target: { value: 'en' } });
    fireEvent.click(screen.getByRole('button', { name: /crea profilo/i }));

    await waitFor(() => expect(onComplete).toHaveBeenCalledOnce());
    const profile = onComplete.mock.calls[0][0];
    expect(profile.name).toBe('Kids');
    expect(profile.playlistUrl).toBe('http://example.test/playlist.m3u');
    expect(profile.preferences?.language).toBe('en');
    // Profilo salvato in localStorage via ProfileService.create
    expect(ProfileService.getAll().some((p) => p.id === profile.id)).toBe(true);
  });

  it('"Configura dopo" permette di creare un profilo senza fonte', async () => {
    const onComplete = vi.fn();
    render(<OnboardingWizard open onClose={() => {}} onComplete={onComplete} />);

    fireEvent.change(screen.getByLabelText(/nome profilo/i), { target: { value: 'Vuoto' } });
    fireEvent.click(screen.getByRole('button', { name: /avanti/i }));
    fireEvent.click(screen.getByRole('button', { name: /configura dopo/i }));
    fireEvent.click(screen.getByRole('button', { name: /avanti/i }));
    fireEvent.click(screen.getByRole('button', { name: /crea profilo/i }));

    await waitFor(() => expect(onComplete).toHaveBeenCalledOnce());
    const profile = onComplete.mock.calls[0][0];
    expect(profile.xtreamCreds).toBeNull();
    expect(profile.playlistUrl).toBeUndefined();
  });
});


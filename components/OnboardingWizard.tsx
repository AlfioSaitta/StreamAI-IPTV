/**
 * OnboardingWizard (C.2) — creazione profilo guidata in 3 step.
 *
 * Step 1: Identità (nome + colore + avatar) — usa pattern già esistenti
 *         di `ProfileSelection` (palette ridotta + `AvatarPicker`).
 * Step 2: Fonte contenuti — scelta tra Xtream Codes / Playlist M3U remota
 *         / "Salta per ora". Per Xtream: pulsante "Testa connessione" che
 *         chiama `getXtreamAccountInfo` con timeout 10 s e mostra esito
 *         (auth, stato abbonamento, scadenza). Per M3U: validazione
 *         `fetch(url)` con `Range: bytes=0-2047` (fallback GET intero se il
 *         server non supporta Range) e check `#EXTM3U` nei primi byte.
 * Step 3: Preferenze — lingua UI (`<select>` da `SUPPORTED_LANGUAGES`),
 *         API key Gemini opzionale, toggle Auto-next episode.
 *
 * Output: chiama `onComplete(profile)` con il nuovo profilo creato via
 * `ProfileService.create()`; non chiude la modale fino a successo della
 * creazione.
 *
 * Navigazione: bottoni Indietro/Avanti, ↵ avanza, Esc chiude (a meno che
 * un test sia in flight). Step indicators con stato done/current/todo.
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ListVideo,
  Loader2,
  Server,
  Sparkles,
  XCircle,
} from 'lucide-react';
import {
  Avatar,
  AvatarPicker,
  Button,
  Card,
  Chip,
  FormField,
  Input,
  Modal,
  Select,
  ToggleSwitch,
} from './shared';
import { useFocusTrap } from '../hooks/useTvFocus.ts';
import { ProfileService, DEFAULT_PREFERENCES } from '../services/profileService.ts';
import { pickDefaultAvatarFor } from '../services/avatars.ts';
import { getXtreamAccountInfo } from '../services/xtream.ts';
import type {
  Profile,
  ProfilePreferences,
  XtreamCredentials,
} from '../types.ts';

interface OnboardingWizardProps {
  open: boolean;
  onClose: () => void;
  onComplete: (profile: Profile) => void;
}

type SourceMode = 'xtream' | 'm3u' | 'skip';
type TestStatus = 'idle' | 'testing' | 'ok' | 'fail';

interface XtreamTestResult {
  status: TestStatus;
  message?: string;
  expiresAt?: string | null;
  username?: string;
}

interface M3UTestResult {
  status: TestStatus;
  message?: string;
  channelHint?: number;
}

const STEP_TITLES = ['Identità', 'Fonte contenuti', 'Preferenze'] as const;

const WIZARD_COLORS = [
  '#dc2626', '#a855f7', '#ec4899', '#3b82f6',
  '#10b981', '#f59e0b', '#06b6d4', '#f97316',
];

const LANGUAGES: { code: string; label: string }[] = [
  { code: 'it', label: 'Italiano' },
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
  { code: 'fr', label: 'Français' },
  { code: 'de', label: 'Deutsch' },
  { code: 'pt', label: 'Português' },
];

const TEST_TIMEOUT_MS = 10_000;
const M3U_PREVIEW_BYTES = 4096;

/** Promise wrapper con timeout dedicato (indipendente da fetchDirect). */
const withTimeout = <T,>(p: Promise<T>, ms: number, label: string): Promise<T> =>
  Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label}: timeout dopo ${ms / 1000}s`)), ms),
    ),
  ]);

/**
 * Conta i tag `#EXTINF` nei primi byte scaricati. Non è il numero esatto
 * di canali (la playlist potrebbe essere troncata) ma serve solo come
 * indicatore "playlist plausibile".
 */
const countExtinf = (text: string): number => {
  const matches = text.match(/#EXTINF:/g);
  return matches ? matches.length : 0;
};

const OnboardingWizard: React.FC<OnboardingWizardProps> = ({ open, onClose, onComplete }) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const existingCount = useMemo(() => ProfileService.getAll().length, []);

  // === Step 1: identità =====================================================
  const [name, setName] = useState('');
  const [color, setColor] = useState(WIZARD_COLORS[existingCount % WIZARD_COLORS.length]);
  const [avatar, setAvatar] = useState(pickDefaultAvatarFor(existingCount));

  // === Step 2: fonte ========================================================
  const [source, setSource] = useState<SourceMode>('xtream');
  const [xtUrl, setXtUrl] = useState('');
  const [xtUser, setXtUser] = useState('');
  const [xtPass, setXtPass] = useState('');
  const [xtTest, setXtTest] = useState<XtreamTestResult>({ status: 'idle' });
  const [m3uUrl, setM3uUrl] = useState('');
  const [m3uTest, setM3uTest] = useState<M3UTestResult>({ status: 'idle' });

  // === Step 3: preferenze ===================================================
  const [language, setLanguage] = useState<string>(DEFAULT_PREFERENCES.language);
  const [geminiApiKey, setGeminiApiKey] = useState('');
  const [autoNext, setAutoNext] = useState<boolean>(DEFAULT_PREFERENCES.autoNextEpisodeEnabled ?? true);

  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const inFlight = xtTest.status === 'testing' || m3uTest.status === 'testing' || submitting;

  useFocusTrap(open, modalRef, {
    onEscape: () => !inFlight && onClose(),
    initialSelector: '[data-initial-focus="true"]',
  });

  // -------------------------------------------------------------------------
  // Test connessione Xtream
  // -------------------------------------------------------------------------
  const handleXtreamTest = useCallback(async () => {
    const creds: XtreamCredentials = {
      url: xtUrl.trim(),
      username: xtUser.trim(),
      password: xtPass.trim(),
    };
    if (!creds.url || !creds.username || !creds.password) {
      setXtTest({ status: 'fail', message: 'Compila URL, username e password.' });
      return;
    }
    setXtTest({ status: 'testing' });
    try {
      const info = await withTimeout(getXtreamAccountInfo(creds), TEST_TIMEOUT_MS, 'Test Xtream');
      const exp = info.expDate ? new Date(Number(info.expDate) * 1000) : null;
      const expLabel = exp && !Number.isNaN(exp.getTime())
        ? `scade ${exp.toLocaleDateString('it-IT')}`
        : 'nessuna scadenza';
      setXtTest({
        status: 'ok',
        message: `Connesso (${info.status ?? 'Active'}, ${expLabel}).`,
        expiresAt: info.expDate,
        username: info.username,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setXtTest({ status: 'fail', message: msg });
    }
  }, [xtUrl, xtUser, xtPass]);

  // -------------------------------------------------------------------------
  // Test playlist M3U remota (HEAD/Range + check #EXTM3U)
  // -------------------------------------------------------------------------
  const handleM3uTest = useCallback(async () => {
    const url = m3uUrl.trim();
    if (!url) {
      setM3uTest({ status: 'fail', message: 'Inserisci un URL M3U.' });
      return;
    }
    try {
      // Valida sintassi URL prima di toccare la rete.
      // eslint-disable-next-line no-new
      new URL(url);
    } catch {
      setM3uTest({ status: 'fail', message: 'URL non valido.' });
      return;
    }
    setM3uTest({ status: 'testing' });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
        headers: { Range: `bytes=0-${M3U_PREVIEW_BYTES - 1}` },
      });
      if (!res.ok && res.status !== 206) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }
      const text = (await res.text()).slice(0, M3U_PREVIEW_BYTES);
      if (!/#EXTM3U/i.test(text)) {
        throw new Error('Il contenuto non sembra una playlist M3U (manca #EXTM3U).');
      }
      const hint = countExtinf(text);
      setM3uTest({
        status: 'ok',
        message: hint > 0
          ? `Playlist valida. Rilevati almeno ${hint} canali nel preview.`
          : 'Playlist valida (preview senza #EXTINF: la lista completa sarà caricata in seguito).',
        channelHint: hint,
      });
    } catch (err) {
      const msg = err instanceof Error
        ? (err.name === 'AbortError' ? `Timeout dopo ${TEST_TIMEOUT_MS / 1000}s` : err.message)
        : String(err);
      setM3uTest({ status: 'fail', message: msg });
    } finally {
      clearTimeout(timer);
    }
  }, [m3uUrl]);

  // -------------------------------------------------------------------------
  // Validazioni per abilitare "Avanti"
  // -------------------------------------------------------------------------
  const canAdvance = useMemo(() => {
    if (inFlight) return false;
    if (step === 0) return name.trim().length > 0;
    if (step === 1) {
      if (source === 'skip') return true;
      if (source === 'xtream') {
        // Permettiamo di proseguire anche senza test ufficiale, ma se il
        // test è stato eseguito e fallito, blocca finché l'utente non
        // riprova o cambia campo.
        const filled = xtUrl.trim() && xtUser.trim() && xtPass.trim();
        return Boolean(filled) && xtTest.status !== 'fail' && xtTest.status !== 'testing';
      }
      // M3U
      return m3uUrl.trim().length > 0 && m3uTest.status !== 'fail' && m3uTest.status !== 'testing';
    }
    return true;
  }, [step, name, source, xtUrl, xtUser, xtPass, xtTest.status, m3uUrl, m3uTest.status, inFlight]);

  // Reset esito test se l'utente modifica i campi correlati.
  const resetXtTestOnEdit = () => {
    if (xtTest.status !== 'idle') setXtTest({ status: 'idle' });
  };
  const resetM3uTestOnEdit = () => {
    if (m3uTest.status !== 'idle') setM3uTest({ status: 'idle' });
  };

  // -------------------------------------------------------------------------
  // Submit finale
  // -------------------------------------------------------------------------
  const handleFinish = useCallback(async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const prefsPatch: Partial<ProfilePreferences> = {
        language,
        autoNextEpisodeEnabled: autoNext,
      };
      if (geminiApiKey.trim()) prefsPatch.geminiApiKey = geminiApiKey.trim();

      const creds: XtreamCredentials | null = source === 'xtream'
        ? { url: xtUrl.trim(), username: xtUser.trim(), password: xtPass.trim() }
        : null;
      const playlistUrl = source === 'm3u' ? m3uUrl.trim() : undefined;

      const profile = ProfileService.create(name.trim(), {
        color,
        avatar,
        preferences: prefsPatch,
        xtreamCreds: creds && creds.url && creds.username && creds.password ? creds : null,
        playlistUrl,
      });
      onComplete(profile);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }, [name, color, avatar, source, xtUrl, xtUser, xtPass, m3uUrl, language, geminiApiKey, autoNext, onComplete]);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  const stepIndicator = (
    <ol className="flex items-center justify-center gap-2 mb-6" aria-label="Progresso onboarding">
      {STEP_TITLES.map((title, i) => {
        const state: 'done' | 'current' | 'todo' = i < step ? 'done' : i === step ? 'current' : 'todo';
        const tone =
          state === 'current'
            ? 'bg-brand-primary text-white'
            : state === 'done'
              ? 'bg-state-success/20 text-state-success'
              : 'bg-surface-2 text-content-muted';
        return (
          <li key={title} className="flex items-center gap-2">
            <span
              className={`flex items-center justify-center w-7 h-7 rounded-full text-xs font-semibold ${tone}`}
              aria-current={state === 'current' ? 'step' : undefined}
            >
              {state === 'done' ? <CheckCircle2 className="w-icon-sm h-icon-sm" aria-hidden /> : i + 1}
            </span>
            <span className={`text-xs hidden sm:inline ${state === 'todo' ? 'text-content-muted' : 'text-content-primary'}`}>
              {title}
            </span>
            {i < STEP_TITLES.length - 1 && <span className="w-6 h-px bg-DEFAULT" aria-hidden />}
          </li>
        );
      })}
    </ol>
  );

  return (
    <Modal
      open={open}
      onClose={() => !inFlight && onClose()}
      title="Nuovo profilo"
      size="lg"
      ariaLabel="Onboarding nuovo profilo"
    >
      <div ref={modalRef}>
        {stepIndicator}

        {step === 0 && (
          <div className="flex flex-col gap-5">
            <div className="flex items-center gap-4">
              <Avatar avatarId={avatar} color={color} size="xl" shape="card" />
              <div className="flex-1 min-w-0">
                <p className="text-xs uppercase tracking-widest text-content-muted mb-1">Anteprima</p>
                <p className="text-lg font-semibold text-content-primary truncate">
                  {name.trim() || 'Il tuo nome'}
                </p>
              </div>
            </div>

            <FormField label="Nome profilo" htmlFor="wiz-name">
              <Input
                id="wiz-name"
                autoFocus
                type="text"
                placeholder="Es. Salotto"
                value={name}
                onChange={(e) => setName(e.target.value)}
                inputSize="lg"
                data-initial-focus="true"
                maxLength={40}
              />
            </FormField>

            <FormField label="Colore" htmlFor="wiz-color">
              <div id="wiz-color" role="radiogroup" aria-label="Colore profilo" className="flex flex-wrap gap-2">
                {WIZARD_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    role="radio"
                    aria-checked={color === c}
                    aria-label={`Colore ${c}`}
                    onClick={() => setColor(c)}
                    className={`tv-focus-dense w-9 h-9 rounded-full transition-transform hover:scale-110 ${
                      color === c ? 'ring-2 ring-content-primary ring-offset-2 ring-offset-surface-0' : ''
                    }`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </FormField>

            <FormField label="Avatar">
              <AvatarPicker value={avatar} color={color} onChange={setAvatar} />
            </FormField>
          </div>
        )}

        {step === 1 && (
          <div className="flex flex-col gap-5">
            <p className="text-sm text-content-muted">
              Scegli dove caricare i contenuti. Potrai sempre aggiungere o cambiare server in seguito da
              Impostazioni → Server.
            </p>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Fonte contenuti">
              <Chip
                selected={source === 'xtream'}
                onClick={() => setSource('xtream')}
                icon={Server}
              >
                Xtream Codes
              </Chip>
              <Chip
                selected={source === 'm3u'}
                onClick={() => setSource('m3u')}
                icon={ListVideo}
              >
                Playlist M3U
              </Chip>
              <Chip
                selected={source === 'skip'}
                onClick={() => setSource('skip')}
              >
                Configura dopo
              </Chip>
            </div>

            {source === 'xtream' && (
              <div className="flex flex-col gap-4">
                <FormField label="Host URL" htmlFor="wiz-xt-url">
                  <Input
                    id="wiz-xt-url"
                    type="url"
                    placeholder="http://host:port"
                    value={xtUrl}
                    onChange={(e) => { setXtUrl(e.target.value); resetXtTestOnEdit(); }}
                    leftIcon={Server}
                    autoComplete="url"
                  />
                </FormField>
                <FormField label="Username" htmlFor="wiz-xt-user">
                  <Input
                    id="wiz-xt-user"
                    type="text"
                    placeholder="Username"
                    value={xtUser}
                    onChange={(e) => { setXtUser(e.target.value); resetXtTestOnEdit(); }}
                    autoComplete="username"
                  />
                </FormField>
                <FormField label="Password" htmlFor="wiz-xt-pass">
                  <Input
                    id="wiz-xt-pass"
                    type="password"
                    placeholder="Password"
                    value={xtPass}
                    onChange={(e) => { setXtPass(e.target.value); resetXtTestOnEdit(); }}
                    autoComplete="current-password"
                  />
                </FormField>
                <div className="flex items-center gap-3 flex-wrap">
                  <Button
                    type="button"
                    variant="secondary"
                    size="md"
                    onClick={handleXtreamTest}
                    disabled={xtTest.status === 'testing' || !xtUrl.trim() || !xtUser.trim() || !xtPass.trim()}
                    loading={xtTest.status === 'testing'}
                  >
                    {xtTest.status === 'testing' ? 'Test in corso…' : 'Testa connessione'}
                  </Button>
                  {xtTest.status === 'ok' && (
                    <span className="inline-flex items-center gap-2 text-sm text-state-success">
                      <CheckCircle2 className="w-icon-sm h-icon-sm" aria-hidden /> {xtTest.message}
                    </span>
                  )}
                  {xtTest.status === 'fail' && (
                    <span className="inline-flex items-center gap-2 text-sm text-state-error">
                      <XCircle className="w-icon-sm h-icon-sm" aria-hidden /> {xtTest.message}
                    </span>
                  )}
                </div>
              </div>
            )}

            {source === 'm3u' && (
              <div className="flex flex-col gap-4">
                <FormField
                  label="URL playlist M3U"
                  htmlFor="wiz-m3u-url"
                  helper="Es. http://host/playlist.m3u oppure https://provider.example/iptv.m3u8"
                >
                  <Input
                    id="wiz-m3u-url"
                    type="url"
                    placeholder="http://host/playlist.m3u"
                    value={m3uUrl}
                    onChange={(e) => { setM3uUrl(e.target.value); resetM3uTestOnEdit(); }}
                    leftIcon={ListVideo}
                  />
                </FormField>
                <div className="flex items-center gap-3 flex-wrap">
                  <Button
                    type="button"
                    variant="secondary"
                    size="md"
                    onClick={handleM3uTest}
                    disabled={m3uTest.status === 'testing' || !m3uUrl.trim()}
                    loading={m3uTest.status === 'testing'}
                  >
                    {m3uTest.status === 'testing' ? 'Verifica…' : 'Verifica playlist'}
                  </Button>
                  {m3uTest.status === 'ok' && (
                    <span className="inline-flex items-center gap-2 text-sm text-state-success">
                      <CheckCircle2 className="w-icon-sm h-icon-sm" aria-hidden /> {m3uTest.message}
                    </span>
                  )}
                  {m3uTest.status === 'fail' && (
                    <span className="inline-flex items-center gap-2 text-sm text-state-error">
                      <XCircle className="w-icon-sm h-icon-sm" aria-hidden /> {m3uTest.message}
                    </span>
                  )}
                </div>
                <Card elevation="flat" padding="sm" className="!bg-surface-1 text-xs text-content-muted">
                  Le playlist M3U classiche non distinguono Film e Serie TV: i contenuti
                  saranno disponibili nella sezione <strong className="text-content-primary">Live</strong>.
                </Card>
              </div>
            )}

            {source === 'skip' && (
              <Card elevation="flat" padding="md" className="!bg-surface-1">
                <p className="text-sm text-content-muted">
                  Puoi entrare subito con un profilo vuoto e configurare la fonte più tardi da
                  Impostazioni. Utile per provare l'app o creare profili "Kids" con whitelist.
                </p>
              </Card>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="flex flex-col gap-5">
            <FormField label="Lingua interfaccia" htmlFor="wiz-lang">
              <Select
                id="wiz-lang"
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
              >
                {LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>{l.label}</option>
                ))}
              </Select>
            </FormField>

            <FormField
              label="Chiave API Google Gemini (opzionale)"
              htmlFor="wiz-gemini"
              helper="Abilita le raccomandazioni AI. La chiave resta locale, salvata solo sul profilo."
            >
              <Input
                id="wiz-gemini"
                type="password"
                placeholder="AIza…"
                value={geminiApiKey}
                onChange={(e) => setGeminiApiKey(e.target.value)}
                leftIcon={Sparkles}
                autoComplete="off"
              />
            </FormField>

            <div className="flex items-start justify-between gap-4 p-3 rounded-control bg-surface-1">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-content-primary">Auto-next episodio</p>
                <p className="text-xs text-content-muted mt-1">
                  Mostra il countdown "Up Next" durante gli ultimi secondi di un episodio e
                  passa automaticamente al successivo.
                </p>
              </div>
              <ToggleSwitch
                checked={autoNext}
                onChange={setAutoNext}
                ariaLabel="Auto-next episodio"
              />
            </div>

            {submitError && (
              <Card elevation="flat" padding="sm" className="!bg-state-error/10 !border-state-error/30" role="alert">
                <p className="text-sm text-state-error">{submitError}</p>
              </Card>
            )}
          </div>
        )}

        <div className="flex items-center justify-between gap-3 mt-6 pt-4 border-t border-DEFAULT">
          <Button
            type="button"
            variant="ghost"
            size="md"
            onClick={() => (step === 0 ? onClose() : setStep((s) => (s - 1) as 0 | 1 | 2))}
            disabled={inFlight}
            leftIcon={step === 0 ? undefined : ArrowLeft}
          >
            {step === 0 ? 'Annulla' : 'Indietro'}
          </Button>

          {step < 2 ? (
            <Button
              type="button"
              variant="primary"
              size="md"
              onClick={() => setStep((s) => (s + 1) as 0 | 1 | 2)}
              disabled={!canAdvance}
              rightIcon={ArrowRight}
            >
              Avanti
            </Button>
          ) : (
            <Button
              type="button"
              variant="primary"
              size="md"
              onClick={handleFinish}
              disabled={submitting}
              loading={submitting}
              leftIcon={submitting ? Loader2 : CheckCircle2}
            >
              {submitting ? 'Creazione…' : 'Crea profilo'}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
};

export default OnboardingWizard;


import React, { useState, useEffect, useRef } from 'react';
import { Profile, ProfilePreferences, XtreamContent } from '../types.ts';
import { ProfileService, DEFAULT_PREFERENCES } from '../services/profileService.ts';
import { CacheService } from '../services/cacheService.ts';
import { useLanguage } from '../contexts/LanguageContext.tsx';
import XtreamHealthBadge from './XtreamHealthBadge.tsx';
import {
  ArrowLeft,
  User,
  Globe,
  Subtitles,
  Play,
  Monitor,
  ShieldCheck,
  Check,
  Palette,
  Sparkles,
  Zap,
  Trash2,
  Database,
  RefreshCw,
  Clock,
  Image as ImageIcon,
  HardDrive,
  SkipForward,
  History,
  Keyboard,
  Type,
} from 'lucide-react';
import { useEscapeKey, useInitialTvFocus, useTvSpatialNavigation } from '../hooks/useTvFocus.ts';
import { Avatar, AvatarPicker, Button, Card, FormField, Input, Select, ToggleSwitch } from './shared';
import { DEFAULT_AVATAR_ID } from '../services/avatars';

interface ProfileSettingsProps {
  profile: Profile;
  onBack: () => void;
  onProfileUpdate: (profile: Profile) => void;
  onRefreshContent?: () => Promise<{ lastRefreshAt?: number } | void>;
  isContentRefreshing?: boolean;
  contentRefreshMessage?: string;
  onShowShortcuts?: () => void;
  /** BUG-1 §2.3 Step 4: stato per blocco (live/vod/series) per mostrare
   *  un riepilogo "Ultimo stato" nella sezione Sincronizzazione catalogo. */
  catalogHealth?: XtreamContent['health'] | null;
}

const LANGUAGES = [
  { code: 'it', name: 'Italiano' },
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Español' },
  { code: 'fr', name: 'Français' },
  { code: 'de', name: 'Deutsch' },
  { code: 'pt', name: 'Português' },
  { code: 'ru', name: 'Русский' },
  { code: 'ja', name: '日本語' },
  { code: 'ko', name: '한국어' },
  { code: 'zh', name: '中文' },
  { code: 'ar', name: 'العربية' },
];

const THEME_OPTIONS = [
  { value: 'dark', label: 'Dark Mode' },
  { value: 'oled', label: 'OLED (Pure Black)' },
];

// C.6 (2026-05-15) — Accessibilità: scala font selezionabile. I valori in px
// vengono applicati a `<html>` da App.tsx; Tailwind usa `rem`, quindi la UI
// scala in proporzione.
const FONT_SCALE_OPTIONS = [
  { value: 'sm', label: 'Piccolo (14 px)' },
  { value: 'md', label: 'Medio (16 px) — default' },
  { value: 'lg', label: 'Grande (18 px)' },
  { value: 'xl', label: 'Molto grande (20 px)' },
];

const CONTENT_REFRESH_INTERVAL_OPTIONS = [
  { value: '60', label: 'Ogni ora' },
  { value: '180', label: 'Ogni 3 ore' },
  { value: '360', label: 'Ogni 6 ore' },
  { value: '720', label: 'Ogni 12 ore' },
  { value: '1440', label: 'Ogni 24 ore' },
];

const PROFILE_COLORS = [
  '#8b5cf6', '#ec4899', '#3b82f6', '#10b981', '#f59e0b',
  '#ef4444', '#06b6d4', '#f97316', '#84cc16', '#a855f7',
];

interface CacheStatsView {
  totalImages: number;
  imageBytesMB: string;
  imageLimitMB: number;
  imageLimitEntries: number;
  imageTtlDays: number;
  memCacheSize: number;
  hitRate: number;
  storage: {
    usageMB: string;
    quotaGB: string;
    percentUsed: string | number;
    persistent: boolean;
  };
}

// --- Local helpers --------------------------------------------------------

const SectionCard: React.FC<{
  icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
  title: string | undefined;
  iconTone?: 'brand' | 'accent' | 'state-error';
  children: React.ReactNode;
}> = ({ icon: Icon, title, iconTone = 'brand', children }) => {
  const tone =
    iconTone === 'accent'
      ? 'text-brand-accent'
      : iconTone === 'state-error'
        ? 'text-state-error'
        : 'text-brand-primary';
  return (
    <Card elevation="raised" padding="lg" className="space-y-0">
      <h2 className="text-xl font-semibold mb-6 flex items-center gap-3 text-content-primary">
        <Icon className={`w-icon-lg h-icon-lg ${tone}`} aria-hidden={true} />
        {title}
      </h2>
      {children}
    </Card>
  );
};



const Divider: React.FC = () => <div className="border-t border-subtle my-6" />;

// --- Component ------------------------------------------------------------

const ProfileSettings: React.FC<ProfileSettingsProps> = ({
  profile,
  onBack,
  onProfileUpdate,
  onRefreshContent,
  isContentRefreshing = false,
  contentRefreshMessage,
  catalogHealth,
}) => {
  const { t } = useLanguage();
  const [preferences, setPreferences] = useState<ProfilePreferences>(
    { ...DEFAULT_PREFERENCES, ...(profile.preferences || {}) }
  );
  const [profileName, setProfileName] = useState(profile.name);
  const [profileColor, setProfileColor] = useState(profile.color);
  const [profileAvatar, setProfileAvatar] = useState<string>(profile.avatar || DEFAULT_AVATAR_ID);
  const [hasChanges, setHasChanges] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showAvatarPicker, setShowAvatarPicker] = useState(false);
  const [localRefreshMessage, setLocalRefreshMessage] = useState<string | null>(null);
  const [aiCacheMessage, setAiCacheMessage] = useState<string | null>(null);
  const [imageCacheMessage, setImageCacheMessage] = useState<string | null>(null);
  const [cacheStats, setCacheStats] = useState<CacheStatsView | null>(null);
  const screenRef = useRef<HTMLDivElement>(null);

  useInitialTvFocus(true, screenRef, '[data-initial-focus="true"]');
  useEscapeKey(true, onBack);
  useTvSpatialNavigation(true, screenRef);

  useEffect(() => {
    const originalPrefs = { ...DEFAULT_PREFERENCES, ...(profile.preferences || {}) };
    const prefsChanged = JSON.stringify(preferences) !== JSON.stringify(originalPrefs);
    const nameChanged = profileName !== profile.name;
    const colorChanged = profileColor !== profile.color;
    const avatarChanged = profileAvatar !== (profile.avatar || DEFAULT_AVATAR_ID);
    setHasChanges(prefsChanged || nameChanged || colorChanged || avatarChanged);
  }, [preferences, profileName, profileColor, profileAvatar, profile]);

  const refreshCacheStats = async () => {
    const stats = await CacheService.getStats();
    setCacheStats(stats as CacheStatsView);
  };

  useEffect(() => {
    refreshCacheStats().catch(() => undefined);
  }, []);

  const handlePreferenceChange = <K extends keyof ProfilePreferences>(
    key: K,
    value: ProfilePreferences[K]
  ) => {
    setPreferences(prev => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      let updatedProfile = ProfileService.updatePreferences(profile.id, preferences);
      const originalAvatar = profile.avatar || DEFAULT_AVATAR_ID;
      if (
        profileName !== profile.name ||
        profileColor !== profile.color ||
        profileAvatar !== originalAvatar
      ) {
        updatedProfile = ProfileService.updateProfile(profile.id, {
          name: profileName,
          color: profileColor,
          avatar: profileAvatar,
        });
      }
      if (updatedProfile) {
        onProfileUpdate(updatedProfile);
        setHasChanges(false);
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleRefreshContent = async () => {
    if (!onRefreshContent || isContentRefreshing) return;
    setLocalRefreshMessage(null);
    try {
      const result = await onRefreshContent();
      setPreferences(prev => ({
        ...prev,
        contentLastRefreshAt: result?.lastRefreshAt || prev.contentLastRefreshAt,
        contentLastRefreshError: undefined,
      }));
      setLocalRefreshMessage('Lista contenuti aggiornata correttamente.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Aggiornamento contenuti non riuscito.';
      setPreferences(prev => ({ ...prev, contentLastRefreshError: message }));
      setLocalRefreshMessage(message);
    }
  };

  const handleClearAiCache = async () => {
    await CacheService.clearApiByPrefix('ai_');
    setAiCacheMessage('Cache AI svuotata. Le prossime raccomandazioni Gemini verranno rigenerate.');
  };

  const handleOptimizeImageCache = async () => {
    const result = await CacheService.cleanupOldImages({ aggressive: true });
    await refreshCacheStats();
    setImageCacheMessage(
      `Cache immagini ottimizzata: ${result.deleted} elementi rimossi, ${(result.freedBytes / 1024 / 1024).toFixed(2)} MB liberati.`,
    );
  };

  const handleClearImageCache = async () => {
    await CacheService.clearImages();
    await refreshCacheStats();
    setImageCacheMessage('Cache immagini svuotata. Poster e loghi verranno riscaricati quando visibili.');
  };

  const formatLastRefresh = (timestamp?: number) => {
    if (!timestamp) return 'Mai eseguito';
    return new Intl.DateTimeFormat('it-IT', {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(new Date(timestamp));
  };

  return (
    <div
      ref={screenRef}
      className="min-h-screen bg-surface-0 text-content-primary safe-area-screen"
    >
      {/* Header */}
      <div className="sticky top-0 z-50 bg-gradient-to-b from-surface-0 via-surface-0 to-transparent pb-8">
        <div className="max-w-4xl mx-auto px-6 pt-8">
          <div className="flex items-center justify-between">
            <Button
              variant="ghost"
              size="md"
              leftIcon={ArrowLeft}
              onClick={onBack}
              data-initial-focus="true"
            >
              {t.back}
            </Button>

            <Button
              variant="primary"
              size="md"
              onClick={handleSave}
              disabled={!hasChanges || isSaving}
              loading={isSaving}
              leftIcon={isSaving ? undefined : Check}
            >
              {t.saveChanges}
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 pb-16 space-y-8">
        {/* Profile Section */}
        <SectionCard icon={User} title={t.profile}>
          <div className="flex flex-col gap-8">
            <div className="flex flex-col md:flex-row gap-8 items-start">
              {/* Avatar preview (uses selected avatar + color) */}
              <button
                type="button"
                onClick={() => setShowAvatarPicker((v) => !v)}
                className="tv-focus rounded-card transition-transform hover:scale-105 relative group"
                aria-label="Modifica avatar"
                aria-expanded={showAvatarPicker}
              >
                <Avatar
                  avatarId={profileAvatar}
                  color={profileColor}
                  size="xl"
                  shape="card"
                  label={profileName}
                />
                <div className="absolute inset-0 bg-surface-overlay-hard opacity-0 group-hover:opacity-60 transition-opacity rounded-card flex items-center justify-center pointer-events-none">
                  <Palette className="w-icon-xl h-icon-xl text-white" aria-hidden="true" />
                </div>
              </button>

              {/* Name + color */}
              <div className="flex-1 flex flex-col gap-4 w-full">
                <FormField label={t.profileName} htmlFor="profile-settings-name">
                  <Input
                    id="profile-settings-name"
                    type="text"
                    value={profileName}
                    onChange={(e) => setProfileName(e.target.value)}
                    placeholder={t.profileName}
                    inputSize="lg"
                  />
                </FormField>

                <FormField label="Colore">
                  <div
                    role="radiogroup"
                    aria-label="Colore profilo"
                    className="flex flex-wrap gap-2"
                  >
                    {PROFILE_COLORS.map((color) => (
                      <button
                        key={color}
                        type="button"
                        role="radio"
                        aria-checked={profileColor === color}
                        onClick={() => setProfileColor(color)}
                        className={`tv-focus-dense w-9 h-9 rounded-full transition-transform hover:scale-110 ${
                          profileColor === color
                            ? 'ring-2 ring-content-primary ring-offset-2 ring-offset-surface-1'
                            : ''
                        }`}
                        style={{ backgroundColor: color }}
                        aria-label={`Colore ${color}`}
                      />
                    ))}
                  </div>
                </FormField>
              </div>
            </div>

            {/* Avatar picker (collapsible) */}
            {showAvatarPicker && (
              <div className="animate-fade-in">
                <FormField label="Avatar">
                  <AvatarPicker
                    value={profileAvatar}
                    color={profileColor}
                    onChange={setProfileAvatar}
                  />
                </FormField>
              </div>
            )}
          </div>
        </SectionCard>

        {/* Language Settings */}
        <SectionCard icon={Globe} title={t.languageAndSubtitles}>
          <div className="space-y-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="font-medium text-content-primary">{t.contentLanguage}</h3>
                <p className="text-sm text-content-muted mt-1">{t.contentLanguageDesc}</p>
              </div>
              <Select
                value={preferences.language}
                onChange={(e) => handlePreferenceChange('language', e.target.value)}
                className="min-w-[180px] max-w-[220px]"
                aria-label={t.contentLanguage}
              >
                {LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>{l.name}</option>
                ))}
              </Select>
            </div>

            <Divider />

            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <Subtitles className="w-icon-md h-icon-md text-content-muted" aria-hidden="true" />
                <div>
                  <h3 className="font-medium text-content-primary">{t.subtitleLanguage}</h3>
                  <p className="text-sm text-content-muted mt-1">{t.subtitleLanguageDesc}</p>
                </div>
              </div>
              <Select
                value={preferences.subtitleLanguage}
                onChange={(e) => handlePreferenceChange('subtitleLanguage', e.target.value)}
                className="min-w-[180px] max-w-[220px]"
                aria-label={t.subtitleLanguage}
              >
                {LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>{l.name}</option>
                ))}
              </Select>
            </div>
          </div>
        </SectionCard>

        {/* Appearance Settings */}
        <SectionCard icon={Palette} title={t.appearance}>
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Monitor className="w-icon-md h-icon-md text-content-muted" aria-hidden="true" />
              <div>
                <h3 className="font-medium text-content-primary">{t.themeInterface}</h3>
                <p className="text-sm text-content-muted mt-1">{t.themeInterfaceDesc}</p>
              </div>
            </div>
            <Select
              value={preferences.theme || 'dark'}
              onChange={(e) => handlePreferenceChange('theme', e.target.value as 'dark' | 'oled')}
              className="min-w-[200px]"
              aria-label={t.themeInterface}
            >
              {THEME_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </Select>
          </div>

          <Divider />

          {/* C.6 (2026-05-15) — Accessibilità: dimensione testo. */}
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Type className="w-icon-md h-icon-md text-content-muted" aria-hidden="true" />
              <div>
                <h3 className="font-medium text-content-primary">Dimensione testo</h3>
                <p className="text-sm text-content-muted mt-1">
                  Scala globale dell'interfaccia. Utile per TV lontane dal divano o per chi ha bisogno di un testo più grande.
                </p>
              </div>
            </div>
            <Select
              value={preferences.fontScale ?? 'md'}
              onChange={(e) => handlePreferenceChange('fontScale', e.target.value as 'sm' | 'md' | 'lg' | 'xl')}
              className="min-w-[200px]"
              aria-label="Dimensione testo"
            >
              {FONT_SCALE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </Select>
          </div>
        </SectionCard>

        {/* AI Settings — icona AI accent (viola) */}
        <SectionCard icon={Sparkles} title={t.aiSettings} iconTone="accent">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Zap className="w-icon-md h-icon-md text-content-muted" aria-hidden="true" />
              <div>
                <h3 className="font-medium text-content-primary">{t.aiCaching}</h3>
                <p className="text-sm text-content-muted mt-1">{t.aiCachingDesc}</p>
              </div>
            </div>
            <ToggleSwitch
              checked={preferences.aiCaching}
              onChange={(v) => handlePreferenceChange('aiCaching', v)}
              ariaLabel={t.aiCaching}
            />
          </div>

          <Divider />

          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div className="flex items-start gap-3">
              <Sparkles className="w-icon-md h-icon-md text-content-muted mt-0.5" aria-hidden="true" />
              <div>
                <h3 className="font-medium text-content-primary">Svuota cache AI</h3>
                <p className="text-sm text-content-muted mt-1">
                  Cancella solo risposte Gemini e arricchimenti AI salvati per questo dispositivo.
                </p>
                {aiCacheMessage && (
                  <p className="text-xs text-state-success mt-2">{aiCacheMessage}</p>
                )}
              </div>
            </div>
            <Button variant="accent" size="sm" onClick={handleClearAiCache}>
              Svuota cache AI
            </Button>
          </div>

          <Divider />

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <ShieldCheck className="w-icon-md h-icon-md text-content-muted" aria-hidden="true" />
                <div>
                  <h3 className="font-medium text-content-primary">{t.geminiApiKey}</h3>
                  <p className="text-sm text-content-muted mt-1">{t.geminiApiKeyDesc}</p>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <Input
                type="password"
                value={preferences.geminiApiKey || ''}
                onChange={(e) => handlePreferenceChange('geminiApiKey', e.target.value)}
                placeholder="AIza..."
                accent="accent"
                className="font-mono"
                aria-label={t.geminiApiKey}
              />
              <a
                href="https://aistudio.google.com/app/apikey"
                target="_blank"
                rel="noopener noreferrer"
                className="tv-focus text-xs text-brand-accent hover:text-brand-accent-hover transition-colors flex items-center gap-1 w-fit rounded-control px-2 py-1"
              >
                <Globe className="w-icon-xs h-icon-xs" aria-hidden="true" />
                {t.getApiKeyLink}
              </a>
            </div>
          </div>

          <Divider />

          {/* FIX 2026-05-15: re-enable della notifica "AI non configurata"
              dopo che l'utente l'ha silenziata con "Non mostrare più". */}
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Sparkles className="w-icon-md h-icon-md text-content-muted" aria-hidden="true" />
              <div>
                <h3 className="font-medium text-content-primary">Notifica "AI non configurata"</h3>
                <p className="text-sm text-content-muted mt-1">
                  Mostra un promemoria discreto quando la chiave Gemini non è impostata.
                  Si chiude da sola dopo qualche secondo.
                </p>
              </div>
            </div>
            <ToggleSwitch
              checked={!(preferences.hideAiUnavailableHint ?? false)}
              onChange={(v) => handlePreferenceChange('hideAiUnavailableHint', !v)}
              ariaLabel='Notifica "AI non configurata"'
            />
          </div>
        </SectionCard>

        {/* Playback & Debug Settings */}
        <SectionCard icon={Play} title={t.playback}>
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Monitor className="w-icon-md h-icon-md text-content-muted" aria-hidden="true" />
              <div>
                <h3 className="font-medium text-content-primary">{t.debugOverlay}</h3>
                <p className="text-sm text-content-muted mt-1">{t.debugOverlayDesc}</p>
              </div>
            </div>
            <ToggleSwitch
              checked={preferences.debugOverlay}
              onChange={(v) => handlePreferenceChange('debugOverlay', v)}
              ariaLabel={t.debugOverlay}
            />
          </div>

          <Divider />

          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <SkipForward className="w-icon-md h-icon-md text-content-muted" aria-hidden="true" />
              <div>
                <h3 className="font-medium text-content-primary">Episodio successivo automatico</h3>
                <p className="text-sm text-content-muted mt-1">
                  Mostra un conto alla rovescia di 10s a fine episodio e avvia il successivo nelle serie TV.
                </p>
              </div>
            </div>
            <ToggleSwitch
              checked={preferences.autoNextEpisodeEnabled ?? (DEFAULT_PREFERENCES.autoNextEpisodeEnabled ?? true)}
              onChange={(v) => handlePreferenceChange('autoNextEpisodeEnabled', v)}
              ariaLabel="Episodio successivo automatico"
            />
          </div>

          <Divider />

          {/* C.1 (2026-05-15): consente all'utente di riaprire la cheatsheet
              al prossimo avvio dopo averla dismessa con "Non mostrare più".
              La cheatsheet rimane sempre richiamabile manualmente con `?`. */}
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Keyboard className="w-icon-md h-icon-md text-content-muted" aria-hidden="true" />
              <div>
                <h3 className="font-medium text-content-primary">Mostra scorciatoie al primo avvio</h3>
                <p className="text-sm text-content-muted mt-1">
                  Apre automaticamente la scheda delle scorciatoie da tastiera la prossima volta
                  che entri nel profilo. Resta sempre richiamabile manualmente con <kbd>?</kbd>.
                </p>
              </div>
            </div>
            <ToggleSwitch
              checked={!(preferences.hasSeenShortcutsCheatsheet ?? false)}
              onChange={(v) => handlePreferenceChange('hasSeenShortcutsCheatsheet', !v)}
              ariaLabel="Mostra scorciatoie al primo avvio"
            />
          </div>

          <Divider />

          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <History className="w-icon-md h-icon-md text-content-muted" aria-hidden="true" />
              <div>
                <h3 className="font-medium text-content-primary">
                  Soglia "completato" — Continua a guardare
                </h3>
                <p className="text-sm text-content-muted mt-1">
                  Sopra questa percentuale di visione un titolo è considerato completato e sparisce dalla riga "Continua a guardare".
                </p>
              </div>
            </div>
            <Select
              value={String(
                Math.round(
                  ((preferences.continueWatchingCompletedThreshold
                    ?? DEFAULT_PREFERENCES.continueWatchingCompletedThreshold
                    ?? 0.95) as number) * 100,
                ),
              )}
              onChange={(e) =>
                handlePreferenceChange(
                  'continueWatchingCompletedThreshold',
                  Math.max(0.7, Math.min(0.99, Number(e.target.value) / 100)),
                )
              }
              className="min-w-[160px]"
              aria-label='Soglia completato'
            >
              <option value="80">80%</option>
              <option value="85">85%</option>
              <option value="90">90%</option>
              <option value="95">95% (default)</option>
              <option value="98">98%</option>
            </Select>
          </div>

          <Divider />

          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <History className="w-icon-md h-icon-md text-content-muted" aria-hidden="true" />
              <div>
                <h3 className="font-medium text-content-primary">
                  Continua a guardare — Film
                </h3>
                <p className="text-sm text-content-muted mt-1">
                  Mostra la riga "Continua a guardare" per i film. Disabilitata
                  di default: la maggior parte degli utenti vede i film una sola
                  volta e non vuole vederli "in sospeso".
                </p>
              </div>
            </div>
            <ToggleSwitch
              checked={preferences.continueWatchingMoviesEnabled ?? (DEFAULT_PREFERENCES.continueWatchingMoviesEnabled ?? false)}
              onChange={(v) => handlePreferenceChange('continueWatchingMoviesEnabled', v)}
              ariaLabel="Continua a guardare per i film"
            />
          </div>

          <Divider />

          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <History className="w-icon-md h-icon-md text-content-muted" aria-hidden="true" />
              <div>
                <h3 className="font-medium text-content-primary">
                  Continua a guardare — Serie TV
                </h3>
                <p className="text-sm text-content-muted mt-1">
                  Mostra la riga "Continua a guardare" per le serie TV.
                  Abilitata di default per riprendere facilmente gli episodi
                  interrotti.
                </p>
              </div>
            </div>
            <ToggleSwitch
              checked={preferences.continueWatchingSeriesEnabled ?? (DEFAULT_PREFERENCES.continueWatchingSeriesEnabled ?? true)}
              onChange={(v) => handlePreferenceChange('continueWatchingSeriesEnabled', v)}
              ariaLabel="Continua a guardare per le serie TV"
            />
          </div>
        </SectionCard>

        {/* Data & Cache */}
        <SectionCard icon={Database} title="Catalogo contenuti">
          {profile.xtreamCreds && (
            <div className="mb-6">
              <XtreamHealthBadge creds={profile.xtreamCreds} />
            </div>
          )}

          {/* BUG-1 §2.3 Step 4: riepilogo "Ultimo stato" per blocco catalogo.
              Permette all'utente di capire a colpo d'occhio se Films/Series
              sono in errore senza aprire la tab corrispondente. */}
          {catalogHealth && (
            <div className="mb-6 grid grid-cols-1 md:grid-cols-3 gap-3">
              {(['live', 'vod', 'series'] as const).map((key) => {
                const block = catalogHealth[key];
                const label =
                  key === 'live' ? 'Live' : key === 'vod' ? 'Film' : 'Serie TV';
                const tone =
                  block.status === 'ok'      ? 'text-state-success' :
                  block.status === 'stale'   ? 'text-state-warning' :
                  block.status === 'empty'   ? 'text-state-warning' :
                                                'text-state-error';
                const dot =
                  block.status === 'ok'      ? 'bg-state-success' :
                  block.status === 'stale'   ? 'bg-state-warning' :
                  block.status === 'empty'   ? 'bg-state-warning' :
                                                'bg-state-error';
                const statusText =
                  block.status === 'ok'    ? `OK (${block.itemCount ?? 0} elementi)` :
                  block.status === 'stale' ? `Cache (${block.itemCount ?? 0} elementi)` :
                  block.status === 'empty' ? 'Vuoto' :
                                              'Errore';
                return (
                  <Card key={key} elevation="flat" padding="sm">
                    <div className="flex items-center gap-2">
                      <span className={`inline-block w-2 h-2 rounded-full ${dot}`} aria-hidden="true" />
                      <span className="text-sm font-medium text-content-primary">
                        Ultimo stato {label}
                      </span>
                    </div>
                    <p className={`mt-1 text-sm font-semibold ${tone}`}>{statusText}</p>
                    {block.reason && (
                      <p className="mt-1 text-xs text-content-muted line-clamp-2">{block.reason}</p>
                    )}
                  </Card>
                );
              })}
            </div>
          )}

          <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div className="flex items-start gap-3">
                <RefreshCw className="w-icon-md h-icon-md text-content-muted mt-0.5" aria-hidden="true" />
                <div>
                  <h3 className="font-medium text-content-primary">Riscarica lista dal server</h3>
                  <p className="text-sm text-content-muted mt-1">
                    Aggiorna Live, Film e Serie ignorando la cache locale. Utile se il provider ha aggiunto o rimosso contenuti.
                  </p>
                  <p className="text-xs text-content-disabled mt-2">
                    Ultimo aggiornamento: {formatLastRefresh(preferences.contentLastRefreshAt)}
                  </p>
                </div>
              </div>
              <Button
                variant="primary"
                size="sm"
                onClick={handleRefreshContent}
                disabled={!profile.xtreamCreds || isContentRefreshing}
                loading={isContentRefreshing}
                leftIcon={isContentRefreshing ? undefined : RefreshCw}
              >
                {isContentRefreshing ? 'Aggiornamento...' : 'Riscarica lista'}
              </Button>
            </div>

            {(localRefreshMessage || contentRefreshMessage || preferences.contentLastRefreshError) && (
              <Card
                elevation="flat"
                padding="sm"
                className={
                  preferences.contentLastRefreshError
                    ? '!border-state-error/30 !bg-state-error/10'
                    : '!border-state-success/30 !bg-state-success/10'
                }
              >
                <p
                  className={`text-sm ${
                    preferences.contentLastRefreshError ? 'text-state-error' : 'text-state-success'
                  }`}
                >
                  {localRefreshMessage || contentRefreshMessage || preferences.contentLastRefreshError}
                </p>
              </Card>
            )}

            <Divider />

            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div className="flex items-start gap-3">
                <Clock className="w-icon-md h-icon-md text-content-muted mt-0.5" aria-hidden="true" />
                <div>
                  <h3 className="font-medium text-content-primary">Aggiornamento in background</h3>
                  <p className="text-sm text-content-muted mt-1">
                    Quando attivo, StreamAI controlla periodicamente il server e aggiorna il catalogo senza bloccare la navigazione.
                  </p>
                </div>
              </div>
              <ToggleSwitch
                checked={Boolean(preferences.contentAutoRefreshEnabled)}
                onChange={(v) => handlePreferenceChange('contentAutoRefreshEnabled', v)}
                ariaLabel="Aggiornamento in background"
              />
            </div>

            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 pl-0 md:pl-8">
              <div>
                <h3 className="font-medium text-content-primary">Frequenza aggiornamento</h3>
                <p className="text-sm text-content-muted mt-1">
                  Scegli ogni quanto riscaricare la lista dal server.
                </p>
              </div>
              <Select
                value={String(
                  preferences.contentAutoRefreshIntervalMinutes
                    || DEFAULT_PREFERENCES.contentAutoRefreshIntervalMinutes
                    || 360,
                )}
                onChange={(e) =>
                  handlePreferenceChange('contentAutoRefreshIntervalMinutes', Number(e.target.value))
                }
                className="min-w-[180px]"
                aria-label="Frequenza aggiornamento"
              >
                {CONTENT_REFRESH_INTERVAL_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </Select>
            </div>
          </div>
        </SectionCard>

        {/* Cache */}
        <SectionCard icon={Trash2} title="Cache" iconTone="state-error">
          <div className="space-y-6">
            {cacheStats && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <Card elevation="flat" padding="md">
                  <div className="flex items-center gap-2 text-content-muted text-sm">
                    <ImageIcon className="w-icon-sm h-icon-sm" aria-hidden="true" /> Immagini
                  </div>
                  <p className="mt-2 text-2xl font-bold text-content-primary">{cacheStats.totalImages}</p>
                  <p className="text-xs text-content-disabled">
                    {cacheStats.imageBytesMB} MB / {cacheStats.imageLimitMB} MB · TTL {cacheStats.imageTtlDays} giorni
                  </p>
                </Card>
                <Card elevation="flat" padding="md">
                  <div className="flex items-center gap-2 text-content-muted text-sm">
                    <HardDrive className="w-icon-sm h-icon-sm" aria-hidden="true" /> Storage
                  </div>
                  <p className="mt-2 text-2xl font-bold text-content-primary">
                    {cacheStats.storage.percentUsed}%
                  </p>
                  <p className="text-xs text-content-disabled">
                    {cacheStats.storage.usageMB} MB usati / {cacheStats.storage.quotaGB} GB
                  </p>
                </Card>
                <Card elevation="flat" padding="md">
                  <div className="flex items-center gap-2 text-content-muted text-sm">
                    <RefreshCw className="w-icon-sm h-icon-sm" aria-hidden="true" /> Hit rate
                  </div>
                  <p className="mt-2 text-2xl font-bold text-content-primary">{cacheStats.hitRate}%</p>
                  <p className="text-xs text-content-disabled">
                    Memoria: {cacheStats.memCacheSize} URL · max {cacheStats.imageLimitEntries} immagini
                  </p>
                </Card>
              </div>
            )}

            {imageCacheMessage && (
              <Card
                elevation="flat"
                padding="sm"
                className="!border-state-success/30 !bg-state-success/10"
              >
                <p className="text-sm text-state-success">{imageCacheMessage}</p>
              </Card>
            )}

            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <h3 className="font-medium text-content-primary">Cache immagini</h3>
                <p className="text-sm text-content-muted mt-1">
                  Mantiene poster e loghi con limite massimo, TTL e cleanup automatico quando lo storage è sotto pressione.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" size="sm" onClick={handleOptimizeImageCache}>
                  Ottimizza immagini
                </Button>
                <Button variant="danger" size="sm" onClick={handleClearImageCache}>
                  Svuota immagini
                </Button>
              </div>
            </div>

            <Divider />

            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <h3 className="font-medium text-content-primary">{t.clearCache}</h3>
                <p className="text-sm text-content-muted mt-1">{t.clearCacheDesc}</p>
              </div>
              <Button
                variant="danger"
                size="sm"
                onClick={() => {
                  CacheService.clearAll();
                  alert(t.cacheCleared);
                  window.location.reload();
                }}
              >
                {t.clearCache}
              </Button>
            </div>
          </div>
        </SectionCard>
      </div>
    </div>
  );
};

export default ProfileSettings;


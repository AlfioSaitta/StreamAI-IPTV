import React, { useState, useEffect } from 'react';
import { Profile, ProfilePreferences } from '../types.ts';
import { ProfileService, DEFAULT_PREFERENCES } from '../services/profileService.ts';
import { CacheService } from '../services/cacheService.ts';
import { useLanguage } from '../contexts/LanguageContext.tsx';
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
  Clock
} from 'lucide-react';

interface ProfileSettingsProps {
  profile: Profile;
  onBack: () => void;
  onProfileUpdate: (profile: Profile) => void;
  onRefreshContent?: () => Promise<{ lastRefreshAt?: number } | void>;
  isContentRefreshing?: boolean;
  contentRefreshMessage?: string;
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

const CONTENT_REFRESH_INTERVAL_OPTIONS = [
  { value: '60', label: 'Ogni ora' },
  { value: '180', label: 'Ogni 3 ore' },
  { value: '360', label: 'Ogni 6 ore' },
  { value: '720', label: 'Ogni 12 ore' },
  { value: '1440', label: 'Ogni 24 ore' },
];

const PROFILE_COLORS = [
  '#8b5cf6', // Purple
  '#ec4899', // Pink
  '#3b82f6', // Blue
  '#10b981', // Green
  '#f59e0b', // Amber
  '#ef4444', // Red
  '#06b6d4', // Cyan
  '#f97316', // Orange
  '#84cc16', // Lime
  '#a855f7', // Violet
];

const ProfileSettings: React.FC<ProfileSettingsProps> = ({
  profile,
  onBack,
  onProfileUpdate,
  onRefreshContent,
  isContentRefreshing = false,
  contentRefreshMessage,
}) => {
  const { t } = useLanguage();
  const [preferences, setPreferences] = useState<ProfilePreferences>(
    { ...DEFAULT_PREFERENCES, ...(profile.preferences || {}) }
  );
  const [profileName, setProfileName] = useState(profile.name);
  const [profileColor, setProfileColor] = useState(profile.color);
  const [hasChanges, setHasChanges] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [localRefreshMessage, setLocalRefreshMessage] = useState<string | null>(null);

  useEffect(() => {
    const originalPrefs = { ...DEFAULT_PREFERENCES, ...(profile.preferences || {}) };
    const prefsChanged = JSON.stringify(preferences) !== JSON.stringify(originalPrefs);
    const nameChanged = profileName !== profile.name;
    const colorChanged = profileColor !== profile.color;
    setHasChanges(prefsChanged || nameChanged || colorChanged);
  }, [preferences, profileName, profileColor, profile]);

  const handlePreferenceChange = <K extends keyof ProfilePreferences>(
    key: K,
    value: ProfilePreferences[K]
  ) => {
    setPreferences(prev => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      // Update preferences
      let updatedProfile = ProfileService.updatePreferences(profile.id, preferences);
      
      // Update name/color if changed
      if (profileName !== profile.name || profileColor !== profile.color) {
        updatedProfile = ProfileService.updateProfile(profile.id, {
          name: profileName,
          color: profileColor
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
        contentLastRefreshError: undefined
      }));
      setLocalRefreshMessage('Lista contenuti aggiornata correttamente.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Aggiornamento contenuti non riuscito.';
      setPreferences(prev => ({ ...prev, contentLastRefreshError: message }));
      setLocalRefreshMessage(message);
    }
  };

  const formatLastRefresh = (timestamp?: number) => {
    if (!timestamp) return 'Mai eseguito';
    return new Intl.DateTimeFormat('it-IT', {
      dateStyle: 'short',
      timeStyle: 'short'
    }).format(new Date(timestamp));
  };

  const ToggleSwitch: React.FC<{ enabled: boolean; onChange: (v: boolean) => void }> = ({ enabled, onChange }) => (
    <button
      onClick={() => onChange(!enabled)}
      className={`relative w-14 h-8 rounded-full transition-colors duration-200 ${
        enabled ? 'bg-purple-600' : 'bg-gray-700'
      }`}
    >
      <span
        className={`absolute top-1 w-6 h-6 rounded-full bg-white shadow-md transition-transform duration-200 ${
          enabled ? 'translate-x-7' : 'translate-x-1'
        }`}
      />
    </button>
  );

  const SelectDropdown: React.FC<{
    value: string;
    options: { value?: string; label?: string; name?: string; code?: string }[];
    onChange: (v: string) => void;
    valueKey?: string;
    labelKey?: string;
  }> = ({ value, options, onChange, valueKey = 'value', labelKey = 'label' }) => (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white focus:border-purple-500 focus:outline-none transition-colors cursor-pointer min-w-[180px]"
    >
      {options.map((opt) => (
        <option key={(opt as Record<string, string>)[valueKey]} value={(opt as Record<string, string>)[valueKey]}>
          {(opt as Record<string, string>)[labelKey] || opt.name}
        </option>
      ))}
    </select>
  );

  return (
    <div className="min-h-screen bg-[#141414] text-white">
      {/* Header */}
      <div className="sticky top-0 z-50 bg-gradient-to-b from-[#141414] via-[#141414] to-transparent pb-8">
        <div className="max-w-4xl mx-auto px-6 pt-8">
          <div className="flex items-center justify-between">
            <button
              onClick={onBack}
              className="tv-focus flex items-center gap-2 text-gray-400 hover:text-white transition-colors px-4 py-2 rounded-lg hover:bg-white/10"
            >
              <ArrowLeft className="w-5 h-5" />
              <span className="font-medium">{t.back}</span>
            </button>

            <button
              onClick={handleSave}
              disabled={!hasChanges || isSaving}
              className={`tv-focus flex items-center gap-2 px-6 py-2.5 rounded-lg font-semibold transition-all ${
                hasChanges
                  ? 'bg-purple-600 hover:bg-purple-500 text-white shadow-lg shadow-purple-900/50'
                  : 'bg-gray-800 text-gray-500 cursor-not-allowed'
              }`}
            >
              {isSaving ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <Check className="w-5 h-5" />
              )}
              {t.saveChanges}
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 pb-16 space-y-8">
        {/* Profile Section */}
        <section className="bg-white/5 rounded-2xl p-6 border border-white/10">
          <h2 className="text-xl font-semibold mb-6 flex items-center gap-3">
            <User className="w-6 h-6 text-purple-500" />
            {t.profile}
          </h2>

          <div className="flex flex-col md:flex-row gap-8 items-start">
            {/* Avatar with color picker */}
            <div className="relative">
              <button
                onClick={() => setShowColorPicker(!showColorPicker)}
                className="w-28 h-28 rounded-2xl flex items-center justify-center transition-transform hover:scale-105 relative group"
                style={{ backgroundColor: profileColor }}
              >
                <User className="w-14 h-14 text-white/90" />
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity rounded-2xl flex items-center justify-center">
                  <Palette className="w-8 h-8 text-white" />
                </div>
              </button>

              {showColorPicker && (
                <div className="absolute top-full left-0 mt-2 p-3 bg-gray-900 rounded-xl border border-white/10 shadow-2xl z-10 animate-fade-in">
                  <div className="grid grid-cols-5 gap-2">
                    {PROFILE_COLORS.map((color) => (
                      <button
                        key={color}
                        onClick={() => {
                          setProfileColor(color);
                          setShowColorPicker(false);
                        }}
                        className={`w-8 h-8 rounded-full transition-transform hover:scale-110 ${
                          profileColor === color ? 'ring-2 ring-white ring-offset-2 ring-offset-gray-900' : ''
                        }`}
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Name input */}
            <div className="flex-1 space-y-2">
              <label className="text-sm text-gray-400">{t.profileName}</label>
              <input
                type="text"
                value={profileName}
                onChange={(e) => setProfileName(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white text-lg focus:border-purple-500 focus:outline-none transition-colors"
                placeholder={t.profileName}
              />
            </div>
          </div>
        </section>

        {/* Language Settings */}
        <section className="bg-white/5 rounded-2xl p-6 border border-white/10">
          <h2 className="text-xl font-semibold mb-6 flex items-center gap-3">
            <Globe className="w-6 h-6 text-purple-500" />
            {t.languageAndSubtitles}
          </h2>

          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-medium text-white">{t.contentLanguage}</h3>
                <p className="text-sm text-gray-400 mt-1">{t.contentLanguageDesc}</p>
              </div>
              <SelectDropdown
                value={preferences.language}
                options={LANGUAGES}
                onChange={(v) => handlePreferenceChange('language', v)}
                valueKey="code"
                labelKey="name"
              />
            </div>

            <div className="border-t border-white/10" />

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Subtitles className="w-5 h-5 text-gray-400" />
                <div>
                  <h3 className="font-medium text-white">{t.subtitleLanguage}</h3>
                  <p className="text-sm text-gray-400 mt-1">{t.subtitleLanguageDesc}</p>
                </div>
              </div>
              <SelectDropdown
                value={preferences.subtitleLanguage}
                options={LANGUAGES}
                onChange={(v) => handlePreferenceChange('subtitleLanguage', v)}
                valueKey="code"
                labelKey="name"
              />
            </div>
          </div>
        </section>

        {/* Appearance Settings */}
        <section className="bg-white/5 rounded-2xl p-6 border border-white/10">
          <h2 className="text-xl font-semibold mb-6 flex items-center gap-3">
            <Palette className="w-6 h-6 text-purple-500" />
            {t.appearance}
          </h2>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Monitor className="w-5 h-5 text-gray-400" />
              <div>
                <h3 className="font-medium text-white">{t.themeInterface}</h3>
                <p className="text-sm text-gray-400 mt-1">{t.themeInterfaceDesc}</p>
              </div>
            </div>
            <SelectDropdown
              value={preferences.theme || 'dark'}
              options={THEME_OPTIONS}
              onChange={(v) => handlePreferenceChange('theme', v as 'dark' | 'oled')}
            />
          </div>
        </section>

        {/* AI Settings */}
        <section className="bg-white/5 rounded-2xl p-6 border border-white/10">
          <h2 className="text-xl font-semibold mb-6 flex items-center gap-3">
            <Sparkles className="w-6 h-6 text-purple-500" />
            {t.aiSettings}
          </h2>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Zap className="w-5 h-5 text-gray-400" />
              <div>
                <h3 className="font-medium text-white">{t.aiCaching}</h3>
                <p className="text-sm text-gray-400 mt-1">{t.aiCachingDesc}</p>
              </div>
            </div>
            <ToggleSwitch
              enabled={preferences.aiCaching}
              onChange={(v) => handlePreferenceChange('aiCaching', v)}
            />
          </div>

          <div className="border-t border-white/10 my-6" />

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <ShieldCheck className="w-5 h-5 text-gray-400" />
                <div>
                  <h3 className="font-medium text-white">{t.geminiApiKey}</h3>
                  <p className="text-sm text-gray-400 mt-1">{t.geminiApiKeyDesc}</p>
                </div>
              </div>
            </div>
            
            <div className="flex flex-col gap-3">
              <input
                type="password"
                value={preferences.geminiApiKey || ''}
                onChange={(e) => handlePreferenceChange('geminiApiKey', e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white focus:border-purple-500 focus:outline-none transition-colors font-mono text-sm"
                placeholder="AIza..."
              />
              <a 
                href="https://aistudio.google.com/app/apikey" 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-xs text-purple-400 hover:text-purple-300 transition-colors flex items-center gap-1 w-fit"
              >
                <Globe className="w-3 h-3" />
                {t.getApiKeyLink}
              </a>
            </div>
          </div>
        </section>

        {/* Playback & Debug Settings */}
        <section className="bg-white/5 rounded-2xl p-6 border border-white/10">
          <h2 className="text-xl font-semibold mb-6 flex items-center gap-3">
            <Play className="w-6 h-6 text-purple-500" />
            {t.playback}
          </h2>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Monitor className="w-5 h-5 text-gray-400" />
              <div>
                <h3 className="font-medium text-white">{t.debugOverlay}</h3>
                <p className="text-sm text-gray-400 mt-1">{t.debugOverlayDesc}</p>
              </div>
            </div>
            <ToggleSwitch
              enabled={preferences.debugOverlay}
              onChange={(v) => handlePreferenceChange('debugOverlay', v)}
            />
          </div>
        </section>

        {/* Data & Cache */}
        <section className="bg-white/5 rounded-2xl p-6 border border-white/10">
          <h2 className="text-xl font-semibold mb-6 flex items-center gap-3">
            <Database className="w-6 h-6 text-purple-500" />
            Catalogo contenuti
          </h2>

          <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div className="flex items-start gap-3">
                <RefreshCw className="w-5 h-5 text-gray-400 mt-0.5" />
                <div>
                  <h3 className="font-medium text-white">Riscarica lista dal server</h3>
                  <p className="text-sm text-gray-400 mt-1">
                    Aggiorna Live, Film e Serie ignorando la cache locale. Utile se il provider ha aggiunto o rimosso contenuti.
                  </p>
                  <p className="text-xs text-gray-500 mt-2">Ultimo aggiornamento: {formatLastRefresh(preferences.contentLastRefreshAt)}</p>
                </div>
              </div>
              <button
                onClick={handleRefreshContent}
                disabled={!profile.xtreamCreds || isContentRefreshing}
                className={`tv-focus px-4 py-2 rounded-lg transition-all font-medium flex items-center justify-center gap-2 ${
                  profile.xtreamCreds && !isContentRefreshing
                    ? 'bg-purple-600 hover:bg-purple-500 text-white shadow-lg shadow-purple-900/30'
                    : 'bg-gray-800 text-gray-500 cursor-not-allowed'
                }`}
              >
                <RefreshCw className={`w-4 h-4 ${isContentRefreshing ? 'animate-spin' : ''}`} />
                {isContentRefreshing ? 'Aggiornamento...' : 'Riscarica lista'}
              </button>
            </div>

            {(localRefreshMessage || contentRefreshMessage || preferences.contentLastRefreshError) && (
              <div className={`rounded-xl border px-4 py-3 text-sm ${preferences.contentLastRefreshError ? 'bg-red-950/30 border-red-500/30 text-red-200' : 'bg-green-950/30 border-green-500/30 text-green-200'}`}>
                {localRefreshMessage || contentRefreshMessage || preferences.contentLastRefreshError}
              </div>
            )}

            <div className="border-t border-white/10" />

            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div className="flex items-start gap-3">
                <Clock className="w-5 h-5 text-gray-400 mt-0.5" />
                <div>
                  <h3 className="font-medium text-white">Aggiornamento in background</h3>
                  <p className="text-sm text-gray-400 mt-1">
                    Quando attivo, StreamAI controlla periodicamente il server e aggiorna il catalogo senza bloccare la navigazione.
                  </p>
                </div>
              </div>
              <ToggleSwitch
                enabled={Boolean(preferences.contentAutoRefreshEnabled)}
                onChange={(v) => handlePreferenceChange('contentAutoRefreshEnabled', v)}
              />
            </div>

            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 pl-0 md:pl-8">
              <div>
                <h3 className="font-medium text-white">Frequenza aggiornamento</h3>
                <p className="text-sm text-gray-400 mt-1">Scegli ogni quanto riscaricare la lista dal server.</p>
              </div>
              <SelectDropdown
                value={String(preferences.contentAutoRefreshIntervalMinutes || DEFAULT_PREFERENCES.contentAutoRefreshIntervalMinutes || 360)}
                options={CONTENT_REFRESH_INTERVAL_OPTIONS}
                onChange={(v) => handlePreferenceChange('contentAutoRefreshIntervalMinutes', Number(v))}
              />
            </div>
          </div>
        </section>

        {/* Cache */}
        <section className="bg-white/5 rounded-2xl p-6 border border-white/10">
          <h2 className="text-xl font-semibold mb-6 flex items-center gap-3">
            <Trash2 className="w-6 h-6 text-red-500" />
            Cache
          </h2>

          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-medium text-white">{t.clearCache}</h3>
              <p className="text-sm text-gray-400 mt-1">{t.clearCacheDesc}</p>
            </div>
            <button
              onClick={() => {
                CacheService.clearAll();
                alert(t.cacheCleared);
                window.location.reload();
              }}
              className="bg-red-600/20 hover:bg-red-600 text-red-400 hover:text-white border border-red-500/30 px-4 py-2 rounded-lg transition-all font-medium"
            >
              {t.clearCache}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
};

export default ProfileSettings;


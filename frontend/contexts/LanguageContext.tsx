import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, ReactNode } from 'react';
import { i18n, Translations, SupportedLanguage, loadLanguage } from '../services/i18n.ts';
import { DEFAULT_PREFERENCES } from '../services/profileService.ts';

interface LanguageContextType {
  language: SupportedLanguage;
  setLanguage: (lang: string) => void;
  t: Translations;
}

const LanguageContext = createContext<LanguageContextType>({
  language: 'it',
  setLanguage: () => {},
  t: i18n.t()
});

interface LanguageProviderProps {
  children: ReactNode;
  profileLanguage?: string;
}

export const LanguageProvider: React.FC<LanguageProviderProps> = ({ children, profileLanguage }) => {
  const initial = (profileLanguage as SupportedLanguage) || (DEFAULT_PREFERENCES.language as SupportedLanguage);
  const [language, setLanguageState] = useState<SupportedLanguage>(
    i18n.isSupported(initial) ? initial : 'it'
  );
  // Active dictionary kept in state so a lazy-loaded locale triggers a
  // re-render once resolved. We start from whatever is already cached
  // (always at least 'it'); other locales are fetched on-demand (B.3).
  const [t, setT] = useState<Translations>(() => i18n.forLanguage(language));

  useEffect(() => {
    let cancelled = false;
    i18n.setLanguageSync(language);
    loadLanguage(language).then((dict) => {
      if (!cancelled) setT(dict);
    });
    return () => { cancelled = true; };
  }, [language]);

  useEffect(() => {
    if (profileLanguage && i18n.isSupported(profileLanguage) && profileLanguage !== language) {
      setLanguageState(profileLanguage as SupportedLanguage);
    }
  }, [profileLanguage, language]);

  const setLanguage = useCallback((lang: string) => {
    if (i18n.isSupported(lang)) {
      setLanguageState(lang as SupportedLanguage);
    }
  }, []);

  // Memoizzato: ricreare l'oggetto a ogni render del provider invalidava il
  // context per tutti i consumer di `useLanguage()` (ChannelList, MovieDetail,
  // SeriesDetail, ProfileSettings) anche quando lingua e dizionario non
  // cambiavano, annullando i loro `React.memo`.
  const value = useMemo<LanguageContextType>(
    () => ({ language, setLanguage, t }),
    [language, setLanguage, t],
  );

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = () => useContext(LanguageContext);

export default LanguageContext;


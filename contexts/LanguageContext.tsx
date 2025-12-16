import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { i18n, Translations, SupportedLanguage } from '../services/i18n.ts';
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
  const [language, setLanguageState] = useState<SupportedLanguage>(
    (profileLanguage as SupportedLanguage) || DEFAULT_PREFERENCES.language as SupportedLanguage
  );
  
  useEffect(() => {
    if (profileLanguage && i18n.isSupported(profileLanguage)) {
      setLanguageState(profileLanguage as SupportedLanguage);
      i18n.setLanguage(profileLanguage);
    }
  }, [profileLanguage]);
  
  const setLanguage = (lang: string) => {
    if (i18n.isSupported(lang)) {
      setLanguageState(lang as SupportedLanguage);
      i18n.setLanguage(lang);
    }
  };
  
  const value: LanguageContextType = {
    language,
    setLanguage,
    t: i18n.forLanguage(language)
  };
  
  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = () => useContext(LanguageContext);

export default LanguageContext;


import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { arabic, type Language } from './translations';
type Variables = Record<string, string | number>;
type LanguageContext = {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (source: string, variables?: Variables) => string;
};
const Context = createContext<LanguageContext | null>(null);
export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>(() => {
    try {
      return localStorage.getItem('meet8-language') === 'ar' ? 'ar' : 'en';
    } catch {
      return 'en';
    }
  });
  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
    try {
      localStorage.setItem('meet8-language', language);
    } catch {
      /* Storage may be disabled. */
    }
  }, [language]);
  function t(source: string, variables?: Variables): string {
    const translated = language === 'ar' ? (arabic[source] ?? source) : source;
    return translated.replace(/\{(\w+)\}/g, (match, key: string) =>
      variables?.[key] === undefined ? match : String(variables[key]),
    );
  }
  return <Context.Provider value={{ language, setLanguage, t }}>{children}</Context.Provider>;
}
export function useLanguage() {
  const context = useContext(Context);
  if (!context) throw new Error('useLanguage must be used within LanguageProvider');
  return context;
}
export function LanguageSwitcher() {
  const { language, setLanguage } = useLanguage();
  return (
    <button
      type="button"
      className="language-switcher"
      aria-label={language === 'en' ? 'Switch to Arabic' : 'Switch to English'}
      onClick={() => setLanguage(language === 'en' ? 'ar' : 'en')}
      lang={language === 'en' ? 'ar' : 'en'}
      dir="auto"
    >
      {language === 'en' ? 'العربية' : 'English'}
    </button>
  );
}

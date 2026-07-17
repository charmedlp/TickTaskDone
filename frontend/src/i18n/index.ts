import { createI18n } from 'vue-i18n';
import type { Locale } from '@ticktaskdone/shared';
import en from './en.json';
import fr from './fr.json';

// Vue I18n is our single translation layer (i18n brief §2.1): messages, plurals,
// interpolation, and locale-aware date/number formatting (delegated to Intl). English
// is the base locale; French is layered on top. Date/time formatting stays close to
// the browser wall-clock — see lib/datetime.ts / lib/format.ts, which read `intlLocale`.
export const SUPPORTED_LOCALES: Locale[] = ['en', 'fr'];
const STORAGE_KEY = 'ttd.locale';

// Map our short locale to a BCP-47 tag for Intl (keeps the ISO date/24h style we use).
const INTL_TAG: Record<Locale, string> = { en: 'en-CA', fr: 'fr-CA' };

export const i18n = createI18n({
  legacy: false,
  locale: 'en',
  fallbackLocale: 'en',
  messages: { en, fr },
});

// The BCP-47 tag for the active locale — used by lib/format's Intl formatters. Reads
// the reactive i18n locale so date labels re-render when the language changes.
export const intlLocaleTag = (): string => INTL_TAG[i18n.global.locale.value as Locale] ?? INTL_TAG.en;

const isLocale = (value: string): value is Locale => (SUPPORTED_LOCALES as string[]).includes(value);

// Apply a locale everywhere: i18n, the persisted fallback, and <html lang>.
export const setLocale = (locale: Locale): void => {
  i18n.global.locale.value = locale;
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // storage may be unavailable (private mode) — non-fatal, the user pref still loads from the API
  }
  document.documentElement.lang = locale;
};

// Best-effort locale before the user's stored preference loads: persisted choice, then
// the browser language, else English. The API value (user.locale) overrides this later.
export const initialLocale = (): Locale => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && isLocale(stored)) {
      return stored;
    }
  } catch {
    // ignore
  }
  const browser = navigator.language.slice(0, 2);
  return isLocale(browser) ? browser : 'en';
};

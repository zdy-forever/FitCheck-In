import i18n from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { initReactI18next } from 'react-i18next'
import en from './locales/en'
import zhCN from './locales/zh-CN'
import zhTW from './locales/zh-TW'

export const LANGUAGES = [
  { code: 'en', label: 'English', short: 'EN' },
  { code: 'zh-CN', label: '简体中文', short: '简' },
  { code: 'zh-TW', label: '繁體中文', short: '繁' },
] as const
export type Language = (typeof LANGUAGES)[number]['code']
export const LANGUAGE_STORAGE_KEY = 'fitcheckin.lang'

/**
 * Maps any browser/stored tag to a supported UI language.
 * Traditional: zh-TW, zh-HK, zh-MO and any zh-Hant-* tag. Other zh (zh, zh-CN, zh-SG,
 * zh-Hans-*) → Simplified. Everything else → English.
 */
export function normalizeLanguage(lng: string | undefined | null): Language {
  const l = (lng ?? '').toLowerCase().replace('_', '-')
  if (!l.startsWith('zh')) return 'en'
  if (/^zh-(hant|tw|hk|mo)\b/.test(l)) return 'zh-TW'
  return 'zh-CN'
}

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: { en: { translation: en }, 'zh-CN': { translation: zhCN }, 'zh-TW': { translation: zhTW } },
    fallbackLng: 'en',
    supportedLngs: ['en', 'zh-CN', 'zh-TW'],
    nonExplicitSupportedLngs: false,
    load: 'currentOnly',
    returnObjects: true,
    interpolation: { escapeValue: false },
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: LANGUAGE_STORAGE_KEY,
      // Only an explicit choice is stored (see chooseLanguage). Caching every detection would
      // store the browser default on first load and make it look like a user choice, so the
      // language saved on the account would never apply on a new device.
      caches: [],
      convertDetectedLanguage: (lng: string) => normalizeLanguage(lng),
    },
  })

function syncDocumentLang(lng: string) {
  if (typeof document !== 'undefined') document.documentElement.lang = normalizeLanguage(lng)
}
syncDocumentLang(i18n.language)
i18n.on('languageChanged', syncDocumentLang)

/** Explicit user choice: switch now and remember it on this device. */
export async function chooseLanguage(lng: Language) {
  await i18n.changeLanguage(lng)
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, lng)
  } catch {
    /* storage unavailable: still switched for this session */
  }
}

export default i18n

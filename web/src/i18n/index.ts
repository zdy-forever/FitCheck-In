import i18n from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { initReactI18next } from 'react-i18next'
import en from './locales/en'
import zhCN from './locales/zh-CN'

export const LANGUAGES = [
  { code: 'en', label: 'English', short: 'EN' },
  { code: 'zh-CN', label: '简体中文', short: '中' },
] as const
export type Language = (typeof LANGUAGES)[number]['code']
export const LANGUAGE_STORAGE_KEY = 'fitcheckin.lang'

export function normalizeLanguage(lng: string | undefined | null): Language {
  return lng && lng.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en'
}

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: { en: { translation: en }, 'zh-CN': { translation: zhCN } },
    fallbackLng: 'en',
    supportedLngs: ['en', 'zh-CN'],
    nonExplicitSupportedLngs: false,
    load: 'currentOnly',
    returnObjects: true,
    interpolation: { escapeValue: false },
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: LANGUAGE_STORAGE_KEY,
      caches: ['localStorage'],
      convertDetectedLanguage: (lng: string) => normalizeLanguage(lng),
    },
  })

function syncDocumentLang(lng: string) {
  if (typeof document !== 'undefined') document.documentElement.lang = normalizeLanguage(lng)
}
syncDocumentLang(i18n.language)
i18n.on('languageChanged', syncDocumentLang)

export default i18n

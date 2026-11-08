import { Check, Languages, Monitor, Moon, Sun } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/features/auth/AuthProvider'
import { LANGUAGES, normalizeLanguage, type Language } from '@/i18n'
import { supabase } from '@/lib/supabase'
import { useTheme, type ThemePreference } from '@/lib/theme'

function useClickOutside(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && close()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, close])
  return ref
}

const iconBtn = 'group grid size-10 place-items-center rounded-full text-ink-2 transition hover:bg-sunken hover:text-ink active:scale-90'

export function LanguageSwitcher() {
  const { t, i18n } = useTranslation()
  const { profile } = useAuth()
  const [open, setOpen] = useState(false)
  const ref = useClickOutside(open, () => setOpen(false))
  const current = normalizeLanguage(i18n.language)

  const choose = async (lng: Language) => {
    setOpen(false)
    await i18n.changeLanguage(lng) // persisted to localStorage by the detector
    if (profile && profile.locale !== lng) {
      // Sync preference to the account; failure is non-blocking.
      await supabase.from('profiles').update({ locale: lng }).eq('id', profile.id)
    }
  }

  return (
    <div className="relative" ref={ref}>
      <button type="button" className="flex h-10 items-center gap-1 rounded-full px-3 text-ink-2 transition hover:bg-sunken hover:text-ink active:scale-95" aria-haspopup="menu" aria-expanded={open} aria-label={t('nav.language')} onClick={() => setOpen((v) => !v)} data-testid="lang-switch">
        <Languages className="size-[18px]" aria-hidden />
        <span className="text-sm font-medium">{LANGUAGES.find((l) => l.code === current)?.short}</span>
      </button>
      {open && (
        <div role="menu" className="glass-strong absolute right-0 top-12 z-50 w-44 rounded-2xl p-1.5">
          {LANGUAGES.map((l) => (
            <button key={l.code} role="menuitemradio" aria-checked={current === l.code} type="button" onClick={() => void choose(l.code)} className="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm text-ink transition-colors hover:bg-sunken" lang={l.code}>
              {l.label}
              {current === l.code && <Check className="size-4 text-accent" aria-hidden />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function ThemeSwitcher() {
  const { t } = useTranslation()
  const { preference, resolved, setPreference } = useTheme()
  const [open, setOpen] = useState(false)
  const ref = useClickOutside(open, () => setOpen(false))
  const options: { value: ThemePreference; label: string; Icon: typeof Sun }[] = [
    { value: 'light', label: t('nav.themeLight'), Icon: Sun },
    { value: 'dark', label: t('nav.themeDark'), Icon: Moon },
    { value: 'system', label: t('nav.themeSystem'), Icon: Monitor },
  ]
  const CurrentIcon = resolved === 'dark' ? Moon : Sun
  return (
    <div className="relative" ref={ref}>
      <button type="button" className={iconBtn} aria-haspopup="menu" aria-expanded={open} aria-label={t('nav.theme')} onClick={() => setOpen((v) => !v)} data-testid="theme-switch">
        <CurrentIcon className="size-[18px] transition-transform duration-500 group-hover:rotate-45" aria-hidden />
      </button>
      {open && (
        <div role="menu" className="glass-strong absolute right-0 top-12 z-50 w-44 rounded-2xl p-1.5">
          {options.map(({ value, label, Icon }) => (
            <button key={value} role="menuitemradio" aria-checked={preference === value} type="button" onClick={() => { setPreference(value); setOpen(false) }} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm text-ink hover:bg-sunken">
              <Icon className="size-4 text-ink-3" aria-hidden />
              <span className="flex-1 text-left">{label}</span>
              {preference === value && <Check className="size-4 text-accent" aria-hidden />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

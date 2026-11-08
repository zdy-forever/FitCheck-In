import { normalizeLanguage } from '@/i18n'

/** Locale-aware formatting helpers (dates, numbers, relative time). */
export function useFormatters(lang: string) {
  const locale = normalizeLanguage(lang)
  const num = (v: number | null | undefined, digits = 0) =>
    v === null || v === undefined || !Number.isFinite(v)
      ? '—'
      : new Intl.NumberFormat(locale, { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(v)
  const date = (iso: string | number | Date, opts: Intl.DateTimeFormatOptions = { dateStyle: 'medium' }) =>
    new Intl.DateTimeFormat(locale, opts).format(new Date(iso))
  const dateTime = (iso: string | number | Date) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso))
  const time = (iso: string | number | Date) => new Intl.DateTimeFormat(locale, { timeStyle: 'short' }).format(new Date(iso))
  const weekdayShort = (iso: string | number | Date) =>
    new Intl.DateTimeFormat(locale, { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(iso))
  const relative = (iso: string | number | Date | null | undefined, now = Date.now()) => {
    if (!iso) return null
    const diff = (new Date(iso).getTime() - now) / 1000
    const abs = Math.abs(diff)
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
    if (abs < 45) return rtf.format(0, 'second')
    if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute')
    if (abs < 86_400) return rtf.format(Math.round(diff / 3600), 'hour')
    if (abs < 86_400 * 30) return rtf.format(Math.round(diff / 86_400), 'day')
    return date(iso)
  }
  const list = (items: string[]) => new Intl.ListFormat(locale, { style: 'short', type: 'conjunction' }).format(items)
  return { locale, num, date, dateTime, time, weekdayShort, relative, list }
}

/** `datetime-local` input value (local time) from an ISO string. */
export function toLocalInputValue(iso: string | Date): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

export function isSameLocalDay(a: string | Date, b: string | Date = new Date()): boolean {
  const x = new Date(a)
  const y = new Date(b)
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate()
}

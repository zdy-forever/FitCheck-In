/**
 * Minimal, dependency-free re-implementation of the Foundation `Calendar` operations
 * that DerivedMetricsEngine relies on, evaluated in an explicit IANA time zone.
 *
 * Swift's engine uses `Calendar.current` (device time zone). On the server we have
 * no "current" time zone, so every caller passes the user's zone explicitly.
 *
 * Semantics mirrored:
 *  - startOfDay(date)                 → local midnight (first valid instant of the day)
 *  - dateComponents([.day], from:to:) → whole calendar days, wall-clock aware (DST safe)
 *  - isDate(_:inSameDayAs:)           → same local Y-M-D
 *  - dateInterval(of: .weekOfYear)    → start of week given `firstWeekday` (1 = Sunday)
 */

const DAY_MS = 86_400_000

interface LocalParts {
  year: number
  month: number // 1-12
  day: number
  hour: number
  minute: number
  second: number
  ms: number
}

const formatterCache = new Map<string, Intl.DateTimeFormat>()

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatterCache.get(timeZone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    formatterCache.set(timeZone, f)
  }
  return f
}

export function localParts(instant: number, timeZone: string): LocalParts {
  const parts = formatter(timeZone).formatToParts(new Date(instant))
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value)
  const ms = ((instant % 1000) + 1000) % 1000
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour') % 24,
    minute: get('minute'),
    second: get('second'),
    ms,
  }
}

/** Offset (ms) such that local wall time = instant + offset. */
function offsetAt(instant: number, timeZone: string): number {
  const p = localParts(instant, timeZone)
  const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second, p.ms)
  return asUTC - instant
}

/**
 * Converts a local wall-clock time to an instant. For wall times skipped by a DST
 * gap, Foundation moves forward by the gap length; for repeated wall times it picks
 * the earlier instant. We mirror both behaviours.
 */
export function fromLocal(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  ms: number,
  timeZone: string,
): number {
  const wall = Date.UTC(year, month - 1, day, hour, minute, second, ms)
  // Candidate offsets around the wall time (covers both sides of a transition).
  const offsets = new Set([offsetAt(wall - DAY_MS, timeZone), offsetAt(wall, timeZone), offsetAt(wall + DAY_MS, timeZone)])
  const matches: number[] = []
  for (const off of offsets) {
    const candidate = wall - off
    if (offsetAt(candidate, timeZone) === off) matches.push(candidate)
  }
  if (matches.length > 0) return Math.min(...matches)
  // Wall time does not exist (spring-forward gap). Interpreting it with the
  // pre-transition offset lands exactly "gap length" later on the wall clock,
  // e.g. 02:30 (EST, skipped) → 03:30 EDT — Foundation's behaviour.
  return wall - offsetAt(wall - DAY_MS, timeZone)
}

export function startOfDay(instant: number, timeZone: string): number {
  const p = localParts(instant, timeZone)
  return fromLocal(p.year, p.month, p.day, 0, 0, 0, 0, timeZone)
}

/** `calendar.date(byAdding: .day, value: n, to: date)` — keeps local wall-clock time. */
export function addDays(instant: number, days: number, timeZone: string): number {
  const p = localParts(instant, timeZone)
  return fromLocal(p.year, p.month, p.day + days, p.hour, p.minute, p.second, p.ms, timeZone)
}

function localDayNumber(instant: number, timeZone: string): number {
  const p = localParts(instant, timeZone)
  return Math.round(Date.UTC(p.year, p.month - 1, p.day) / DAY_MS)
}

/** `calendar.dateComponents([.day], from: from, to: to).day` */
export function wholeDaysBetween(from: number, to: number, timeZone: string): number {
  let n = localDayNumber(to, timeZone) - localDayNumber(from, timeZone)
  if (n > 0) {
    if (addDays(from, n, timeZone) > to) n -= 1
  } else if (n < 0) {
    if (addDays(from, n, timeZone) < to) n += 1
  }
  return n
}

export function isSameDay(a: number, b: number, timeZone: string): boolean {
  return localDayNumber(a, timeZone) === localDayNumber(b, timeZone)
}

/** 1 = Sunday … 7 = Saturday, like Foundation's `.weekday`. */
export function weekday(instant: number, timeZone: string): number {
  const p = localParts(instant, timeZone)
  return new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay() + 1
}

/** `calendar.dateInterval(of: .weekOfYear, for: date)?.start` */
export function startOfWeek(instant: number, timeZone: string, firstWeekday = 1): number {
  const back = (weekday(instant, timeZone) - firstWeekday + 7) % 7
  const p = localParts(instant, timeZone)
  return fromLocal(p.year, p.month, p.day - back, 0, 0, 0, 0, timeZone)
}

/** Local calendar date as `YYYY-MM-DD`. */
export function localDateKey(instant: number, timeZone: string): string {
  const p = localParts(instant, timeZone)
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone })
    return true
  } catch {
    return false
  }
}

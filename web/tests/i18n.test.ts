import { describe, expect, it } from 'vitest'
import en from '@/i18n/locales/en'
import zh from '@/i18n/locales/zh-CN'

function keys(o: unknown, prefix = ''): string[] {
  if (Array.isArray(o)) return [`${prefix}[${o.length}]`]
  if (o && typeof o === 'object') return Object.entries(o).flatMap(([k, v]) => keys(v, prefix ? `${prefix}.${k}` : k))
  return [prefix]
}
function leaves(o: unknown): string[] {
  if (Array.isArray(o)) return o.flatMap(leaves)
  if (o && typeof o === 'object') return Object.values(o).flatMap(leaves)
  return typeof o === 'string' ? [o] : []
}

describe('i18n resources', () => {
  it('zh-CN has exactly the same keys (and array lengths) as en', () => {
    expect(keys(zh).sort()).toEqual(keys(en).sort())
  })
  it('no empty translations', () => {
    expect(leaves(en).filter((s) => !s.trim())).toEqual([])
    expect(leaves(zh).filter((s) => !s.trim())).toEqual([])
  })
  it('zh-CN is actually translated (most strings contain CJK)', () => {
    const all = leaves(zh)
    const cjk = all.filter((s) => /[一-鿿]/.test(s))
    // allowed English-only: brand, HRV, units, email placeholder…
    expect(cjk.length / all.length).toBeGreaterThan(0.85)
  })
  it('interpolation placeholders match between languages', () => {
    const ph = (s: string) => (s.match(/{{\w+}}/g) ?? []).sort().join(',')
    const enMap = new Map(keys(en).map((k, i) => [k, leaves(en)[i]]))
    const zhMap = new Map(keys(zh).map((k, i) => [k, leaves(zh)[i]]))
    for (const [k, v] of enMap) if (v && zhMap.get(k)) expect(ph(zhMap.get(k)!), k).toBe(ph(v))
  })
})

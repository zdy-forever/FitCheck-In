import { describe, expect, it } from 'vitest'
import en from '@/i18n/locales/en'
import zh from '@/i18n/locales/zh-CN'
import tw from '@/i18n/locales/zh-TW'
import { normalizeLanguage } from '@/i18n'

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

  it('zh-TW has exactly the same keys (and array lengths) as en, and matching placeholders', () => {
    expect(keys(tw).sort()).toEqual(keys(en).sort())
    const ph = (x: string) => (x.match(/{{\w+}}/g) ?? []).sort().join(',')
    const enMap = new Map(keys(en).map((k, i) => [k, leaves(en)[i]]))
    const twMap = new Map(keys(tw).map((k, i) => [k, leaves(tw)[i]]))
    for (const [k, v] of enMap) if (v && twMap.get(k)) expect(ph(twMap.get(k)!), k).toBe(ph(v))
    expect(leaves(tw).filter((x) => !x.trim())).toEqual([])
  })
  it('zh-TW is Traditional, not Simplified (no common simplified-only characters, Taiwan wording)', () => {
    const text = leaves(tw).join('\n')
    // Characters that only exist in Simplified Chinese (their Traditional forms differ).
    const simplifiedOnly = '们这时会说为发么个数据设账号练问历质应网络页复杂进动态开关录试级详选择认证删览'
    const found = [...new Set([...text].filter((c) => simplifiedOnly.includes(c)))]
    expect(found).toEqual([])
    // Taiwan usage rather than mainland terms.
    for (const mainland of ['退出登入', '賬號', '質量', '反饋', '實時']) expect(text, mainland).not.toContain(mainland)
    expect(leaves(tw).filter((x) => /[一-鿿]/.test(x)).length / leaves(tw).length).toBeGreaterThan(0.85)
  })
})

describe('language detection', () => {
  it.each([
    ['zh-TW', 'zh-TW'], ['zh-HK', 'zh-TW'], ['zh-MO', 'zh-TW'], ['zh-Hant', 'zh-TW'], ['zh-Hant-TW', 'zh-TW'], ['zh_TW', 'zh-TW'],
    ['zh', 'zh-CN'], ['zh-CN', 'zh-CN'], ['zh-SG', 'zh-CN'], ['zh-Hans', 'zh-CN'], ['zh-Hans-HK', 'zh-CN'],
    ['en-AU', 'en'], ['fr', 'en'], ['', 'en'], [null, 'en'],
  ])('%s → %s', (input, out) => expect(normalizeLanguage(input)).toBe(out))
})

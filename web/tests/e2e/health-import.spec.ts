import { expect, test, type Browser } from '@playwright/test'

const PASSWORD = 'E2e-Passw0rd!'
const uid = () => Math.random().toString(36).slice(2, 8)

/** Export.xml in the iPhone's format, 14 days relative to now (UTC offsets). */
function exportXml(now = Date.now()) {
  const p = (n: number) => String(n).padStart(2, '0')
  const fmt = (t: number) => {
    const d = new Date(t)
    return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} +0000`
  }
  const H = 3_600_000
  const rows: string[] = []
  for (let day = 0; day < 14; day++) {
    const b = now - day * 24 * H
    rows.push(`<Record type="HKQuantityTypeIdentifierHeartRateVariabilitySDNN" sourceName="Watch" unit="ms" startDate="${fmt(b - 4 * H)}" endDate="${fmt(b - 4 * H)}" value="${48 + (day % 5)}"/>`)
    rows.push(`<Record type="HKQuantityTypeIdentifierRestingHeartRate" sourceName="Watch" unit="count/min" startDate="${fmt(b - 5 * H)}" endDate="${fmt(b - 3 * H)}" value="${55 + (day % 3)}"/>`)
    rows.push(`<Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="Watch" startDate="${fmt(b - 11 * H)}" endDate="${fmt(b - 5 * H)}" value="HKCategoryValueSleepAnalysisAsleepCore"/>`)
    rows.push(`<Record type="HKQuantityTypeIdentifierStepCount" sourceName="Watch" unit="count" startDate="${fmt(b - 2 * H)}" endDate="${fmt(b - 1.9 * H)}" value="6400"/>`)
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<HealthData locale="en_AU">\n${rows.join('\n')}\n</HealthData>\n`
}

async function device(browser: Browser, mobile = false) {
  const ctx = await browser.newContext({ locale: 'en-US', ...(mobile ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' } : {}) })
  await ctx.addInitScript(() => { if (!localStorage.getItem('fitcheckin.lang')) localStorage.setItem('fitcheckin.lang', 'en') })
  return ctx.newPage()
}

test('import Apple Health from the iPhone browser via QR code; computer updates live', async ({ browser }) => {
  const id = uid()
  const computer = await device(browser)
  await computer.goto('/auth/client?mode=signup')
  await computer.getByLabel('Your name').fill(`Importer ${id}`)
  await computer.getByLabel('Email').fill(`imp-${id}@e2e.test`)
  await computer.getByLabel('Password').fill(PASSWORD)
  await computer.getByRole('button', { name: 'Create account' }).click()
  await expect(computer).toHaveURL(/\/client$/)

  await computer.goto('/client/health')
  await expect(computer.getByText('No Apple Health data yet')).toBeVisible()
  await computer.getByTestId('create-import-qr').click()
  await expect(computer.getByTestId('import-qr')).toBeVisible()
  const link = (await computer.getByTestId('import-link').textContent())!
  expect(link).toMatch(/\/import\/[A-HJ-NP-Z2-9]{16}$/)

  // "Phone": separate browser context, never signed in.
  const phone = await device(browser, true)
  await phone.goto(new URL(link).pathname)
  await expect(phone.getByText(`For Importer ${id}`)).toBeVisible()
  await expect(phone).toHaveURL(/\/import$/) // one-time code removed from the URL
  await expect(computer.getByTestId('import-paired')).toBeVisible({ timeout: 10_000 })

  await phone.getByTestId('import-file').setInputFiles({ name: 'export.xml', mimeType: 'text/xml', buffer: Buffer.from(exportXml()) })
  await expect(phone.getByTestId('import-done')).toBeVisible({ timeout: 30_000 })
  await expect(phone.getByTestId('import-done')).toContainText('new')

  // Computer: no reload — realtime brings in the snapshot.
  await expect(computer.getByText('Measured (Apple Health)')).toBeVisible({ timeout: 15_000 })
  await expect(computer.getByTestId('trend-hrv')).toBeVisible()

  // The phone keeps working from the home-screen URL without a new code…
  await phone.goto('/import')
  await expect(phone.getByText(`For Importer ${id}`)).toBeVisible()
  await expect(phone.getByText(/Last import/)).toBeVisible()

  // …until the device is unlinked on the computer.
  await computer.goto('/client/settings')
  const devices = computer.locator('li', { hasText: 'Health export' })
  await devices.getByRole('button').first().click()
  await phone.reload()
  await expect(phone.getByTestId('import-error')).toContainText('disconnected')

  // A bad file is reported, not silently ignored.
  await computer.goto('/client/health')
  await computer.getByTestId('create-import-qr').click()
  const link2 = (await computer.getByTestId('import-link').textContent())!
  await phone.goto(new URL(link2).pathname)
  await expect(phone.getByText(`For Importer ${id}`)).toBeVisible()
  await phone.getByTestId('import-file').setInputFiles({ name: 'photo.zip', mimeType: 'application/zip', buffer: Buffer.from('PK\u0003\u0004 not really a zip') })
  await expect(phone.getByTestId('import-error')).toBeVisible({ timeout: 15_000 })
  expect(await phone.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0)
})

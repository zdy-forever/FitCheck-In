import { expect, test } from '@playwright/test'

/**
 * Demo client: submit a check-in using "Use Apple Watch data", then "Back" must show a fresh,
 * empty form; the coach sees which answers came from the watch.
 */
test('check-in: watch prefill is rounded, marked, and "Back" starts an empty form', async ({ page }) => {
  await page.addInitScript(() => { if (!localStorage.getItem('fitcheckin.lang')) localStorage.setItem('fitcheckin.lang', 'en') })
  await page.goto('/auth?demo=1')
  await page.getByTestId('create-demo').click()
  await expect(page.getByTestId('demo-ready')).toBeVisible({ timeout: 30_000 })
  await page.getByTestId('demo-signin-client').click()
  await expect(page).toHaveURL(/\/client$/)
  await page.goto('/client/check-in')

  const form = page.getByTestId('checkin-form')
  const panel = page.getByTestId('watch-prefill')
  await expect(panel).toBeVisible()
  await expect(panel).toContainText('Simulated') // demo data is labelled as such

  await page.getByTestId('use-watch-data').click()
  for (const name of ['sleep', 'energy']) {
    const checked = form.locator(`input[name="${name}"]:checked`)
    await expect(checked).toHaveCount(1)
    expect(Number(await checked.getAttribute('value'))).toBeGreaterThanOrEqual(1)
  }
  // The hint shows the exact mapping and the rounding, and matches the selected value.
  const hint = form.getByText(/From Apple Watch: sleep score \d+\/100 → [\d.]+ → rounded to \d/)
  await expect(hint).toBeVisible()
  const [, exact, rounded] = (await hint.textContent())!.match(/→ ([\d.]+) → rounded to (\d)/)!
  expect(Number(rounded)).toBe(Math.round(Number(exact)))
  expect(await form.locator('input[name="sleep"]:checked').getAttribute('value')).toBe(rounded)
  // Subjective answers are never pre-filled.
  for (const name of ['mental', 'soreness', 'pain']) await expect(form.locator(`input[name="${name}"]:checked`)).toHaveCount(0)

  // Changing a pre-filled answer makes it the client's own (the "from watch" hint goes away).
  const energyNow = Number(await form.locator('input[name="energy"]:checked').getAttribute('value'))
  await form.getByTestId(`energy-${energyNow === 5 ? 4 : energyNow + 1}`).click()
  await expect(form.getByText(/From Apple Watch: recovery/)).toHaveCount(0)

  for (const [name, v] of [['mental', 4], ['soreness', 2], ['pain', 0]] as const) await form.getByTestId(`${name}-${v}`).click()
  await form.locator('textarea[name="goal"]').fill('Tempo run')
  await form.locator('textarea[name="notes"]').fill('Felt fine')
  await page.getByTestId('checkin-submit').click()
  await expect(page.getByTestId('checkin-done')).toBeVisible()

  // Back → a brand-new, empty check-in.
  await page.getByTestId('checkin-again').click()
  await expect(form).toBeVisible()
  await expect(form.locator('input[type="radio"]:checked')).toHaveCount(0)
  await expect(form.locator('textarea[name="goal"]')).toHaveValue('')
  await expect(form.locator('textarea[name="notes"]')).toHaveValue('')
  await expect(form.getByText(/From Apple Watch/)).toHaveCount(0)
  await expect(page.getByTestId('use-watch-data')).toHaveText(/Use Apple Watch data/)

  // History: only sleep quality is marked as watch-derived (energy was changed by the client).
  await page.goto('/client/history')
  const card = page.getByTestId('checkin-card').first()
  await expect(card).toContainText('Tempo run')
  await expect(card.getByTestId('watch-derived')).toHaveCount(1)
})

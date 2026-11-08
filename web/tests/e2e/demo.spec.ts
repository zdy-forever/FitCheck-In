import { expect, test } from '@playwright/test'

test('demo mode: creates a sandbox and shows clearly-labelled simulated health data @mobile', async ({ page }) => {
  await page.addInitScript(() => { if (!localStorage.getItem('fitcheckin.lang')) localStorage.setItem('fitcheckin.lang', 'en') })
  await page.goto('/auth?demo=1')
  await page.getByTestId('create-demo').click()
  await expect(page.getByTestId('demo-ready')).toBeVisible({ timeout: 30_000 })

  await page.getByTestId('demo-signin-trainer').click()
  await expect(page).toHaveURL(/\/trainer$/)
  // Desktop shows a compact badge; mobile shows a full-width banner.
  await expect(page.getByText(/^Demo data$|Simulated demo data/).locator('visible=true').first()).toBeVisible()

  await page.goto('/trainer/clients')
  await page.getByText('Demo Client Sam').locator('visible=true').first().click()

  // Overview keeps only the four headline scores; everything else lives under Health.
  const glance = page.getByTestId('health-glance')
  await expect(glance).toBeVisible()
  for (const label of ['Readiness', 'Recovery', 'Stress', 'Sleep score']) await expect(glance.getByTestId(`score-${label}`)).toBeVisible()
  await expect(glance.getByTestId(/^score-/)).toHaveCount(4)
  await expect(page.getByTestId('fitness-panel')).toHaveCount(0)
  await expect(page.getByTestId('trend-hrv')).toHaveCount(0)
  await expect(page.getByText('Measured (Apple Health)')).toHaveCount(0)
  await expect(page.getByText(/Original health\+ composite/)).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 'no horizontal overflow').toBe(0)
  await glance.getByTestId('health-see-all').locator('visible=true').click()
  await expect(page).toHaveURL(/tab=health/)
  await expect(page.getByText('Measured (Apple Health)')).toBeVisible()
  await expect(page.getByText('Algorithm estimates')).toBeVisible()
  await expect(page.getByTestId('trend-hrv')).toBeVisible()
  // Demo badges on health panels — simulated data is never presented as real.
  // Every simulated panel (measured, estimates, fitness scores, training load) carries a demo label.
  await expect(page.locator('main').getByTitle(/Simulated demo data/).locator('visible=true')).toHaveCount(4)
  await expect(page.getByTestId('fitness-panel')).toBeVisible()
  await expect(page.getByTestId('fit-vitals')).toContainText('Blood oxygen')
  await expect(page.getByTestId('fit-cardio')).toContainText('mL/kg/min')
  await expect(page.getByTestId('training-load')).toBeVisible()
  await expect(page.getByTestId('load-sessions')).toContainText('Client RPE')
  await expect(page.getByText(/not medical assessments/)).toBeVisible()
  await expect(page.getByText(/Original health\+ composite/)).toHaveCount(0)
  await expect(page.getByText(/cards without data are not scored/)).toHaveCount(0)
})

test('client home shows only the four headline scores; full detail is one click away', async ({ page }) => {
  await page.addInitScript(() => { if (!localStorage.getItem('fitcheckin.lang')) localStorage.setItem('fitcheckin.lang', 'en') })
  await page.goto('/auth?demo=1')
  await page.getByTestId('create-demo').click()
  await expect(page.getByTestId('demo-ready')).toBeVisible({ timeout: 30_000 })
  await page.getByTestId('demo-signin-client').click()
  await expect(page).toHaveURL(/\/client$/)
  await expect(page.getByTestId('health-glance').getByTestId(/^score-/)).toHaveCount(4)
  await expect(page.getByTestId('fitness-panel')).toHaveCount(0)
  await page.getByTestId('health-see-all').locator('visible=true').click()
  await expect(page).toHaveURL(/\/client\/health$/)
  await expect(page.getByTestId('fitness-panel')).toBeVisible()
})

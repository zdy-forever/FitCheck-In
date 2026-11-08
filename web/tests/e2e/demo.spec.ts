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
  await page.getByRole('tab', { name: 'Health' }).click()
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
})

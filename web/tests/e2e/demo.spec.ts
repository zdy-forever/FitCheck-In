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
  // The measured panel and the estimates panel each carry a demo label (plus the global header/banner notice).
  await expect(page.locator('main').getByTitle(/Simulated demo data/).locator('visible=true')).toHaveCount(2)
  await expect(page.getByText(/not medical assessments/)).toBeVisible()
})

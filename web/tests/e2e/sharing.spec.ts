import { expect, test, type Browser, type Page } from '@playwright/test'

const PASSWORD = 'E2e-Passw0rd!'
const uid = () => Math.random().toString(36).slice(2, 8)

async function signUp(page: Page, role: 'trainer' | 'client', name: string, email: string) {
  await page.goto(`/auth/${role}?mode=signup`)
  await page.getByLabel('Your name').fill(name)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL(new RegExp(`/${role}$`))
}
async function device(browser: Browser) {
  const ctx = await browser.newContext({ locale: 'en-US' })
  await ctx.addInitScript(() => { if (!localStorage.getItem('fitcheckin.lang')) localStorage.setItem('fitcheckin.lang', 'en') })
  return ctx.newPage()
}
async function invite(page: Page) {
  await page.goto('/trainer/invitations')
  await page.getByTestId('create-invite').click()
  await page.getByTestId('invite-submit').click()
  return (await page.getByTestId('new-invite-code').textContent())!.trim()
}

test('client with two trainers picks a trainer and edits only that trainer’s sharing', async ({ browser }) => {
  const id = uid()
  const a = { name: `Coach A ${id}`, email: `ca-${id}@e2e.test` }
  const b = { name: `Coach B ${id}`, email: `cb-${id}@e2e.test` }
  const [pa, pb, pc] = [await device(browser), await device(browser), await device(browser)]
  await signUp(pa, 'trainer', a.name, a.email)
  await signUp(pb, 'trainer', b.name, b.email)
  const codeA = await invite(pa)
  const codeB = await invite(pb)

  await signUp(pc, 'client', `Client ${id}`, `cl-${id}@e2e.test`)
  for (const code of [codeA, codeB]) {
    await pc.goto('/client/join')
    await pc.getByTestId('invite-code').fill(code)
    await pc.getByRole('button', { name: 'Continue' }).click()
    await pc.getByRole('switch', { name: 'HRV', exact: true }).click()
    await pc.getByTestId('accept-invite').click()
    await expect(pc).toHaveURL(/\/client$/)
  }

  await pc.goto('/client/settings')
  const select = pc.getByTestId('sharing-trainer-select')
  await expect(select).toBeVisible()
  await expect(select.locator('option')).toHaveCount(2)
  await expect(pc.getByTestId('sharing-trainer')).toHaveCount(1) // one list at a time
  await expect(select.locator('option', { hasText: a.name })).toContainText('1/11')

  // Turn HRV off for A only.
  await select.selectOption({ label: `${a.name} · 1/11 shared` })
  const hrvA = pc.getByRole('switch', { name: `${a.name}: HRV` })
  await expect(hrvA).toHaveAttribute('aria-checked', 'true')
  await hrvA.click()
  await expect(hrvA).toHaveAttribute('aria-checked', 'false')
  await expect(select.locator('option', { hasText: a.name })).toContainText('0/11')

  // B is untouched.
  await select.selectOption({ label: `${b.name} · 1/11 shared` })
  await expect(pc.getByRole('switch', { name: `${b.name}: HRV` })).toHaveAttribute('aria-checked', 'true')
  await expect(pc.getByRole('switch', { name: `${a.name}: HRV` })).toHaveCount(0)

  // Selection survives a reload in the same tab.
  await pc.reload()
  await expect(pc.getByRole('switch', { name: `${b.name}: HRV` })).toBeVisible()
  await expect(pc.getByTestId('sharing-trainer-select').locator('option:checked')).toContainText(b.name)
})

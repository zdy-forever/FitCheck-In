import { expect, test, type Browser, type Page } from '@playwright/test'

const uid = () => Math.random().toString(36).slice(2, 8)
const PASSWORD = 'E2e-Passw0rd!'

async function signUp(page: Page, role: 'trainer' | 'client', name: string, email: string) {
  await page.goto(`/auth/${role}?mode=signup`)
  await page.getByLabel('Your name').fill(name)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL(new RegExp(`/${role}$`))
}

async function newDevice(browser: Browser, opts: Parameters<Browser['newContext']>[0] = {}) {
  const ctx = await browser.newContext({ locale: 'en-US', ...opts })
  await ctx.addInitScript(() => { if (!localStorage.getItem('fitcheckin.lang')) localStorage.setItem('fitcheckin.lang', 'en') })
  return ctx.newPage()
}

test.describe.serial('core trainer ↔ client flow across two devices', () => {
  const id = uid()
  const trainer = { name: `Coach ${id}`, email: `coach-${id}@e2e.test` }
  const client = { name: `Client ${id}`, email: `client-${id}@e2e.test` }
  let trainerPage: Page
  let clientPage: Page
  let code = ''

  test.beforeAll(async ({ browser }) => {
    trainerPage = await newDevice(browser) // "laptop"
    clientPage = await newDevice(browser, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }) // "phone"
  })

  test('trainer signs up and creates an invitation', async () => {
    await signUp(trainerPage, 'trainer', trainer.name, trainer.email)
    await expect(trainerPage.getByRole('heading', { name: `Good to see you, ${trainer.name}` })).toBeVisible()
    await trainerPage.goto('/trainer/invitations')
    await trainerPage.getByTestId('create-invite').click()
    await trainerPage.getByTestId('invite-submit').click()
    code = (await trainerPage.getByTestId('new-invite-code').textContent())!.trim()
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/)
  })

  test('client signs up, cannot reach trainer portal, and accepts the invite with HRV+sleep+scores shared', async () => {
    await signUp(clientPage, 'client', client.name, client.email)
    // Role is enforced from the database: visiting the trainer portal bounces back.
    await clientPage.goto('/trainer')
    await expect(clientPage).toHaveURL(/\/client$/)

    await clientPage.goto('/client/join')
    await clientPage.getByTestId('invite-code').fill('BAD')
    await clientPage.getByRole('button', { name: 'Continue' }).click()
    await expect(clientPage.getByText('Invitation codes have 8 letters/numbers.')).toBeVisible()

    await clientPage.getByTestId('invite-code').fill(code)
    await clientPage.getByRole('button', { name: 'Continue' }).click()
    await expect(clientPage.getByText(`Invitation from ${trainer.name}`)).toBeVisible()
    for (const label of ['Readiness & recovery estimates', 'HRV', 'Sleep']) await clientPage.getByRole('switch', { name: label, exact: true }).click()
    await clientPage.getByTestId('accept-invite').click()
    await expect(clientPage).toHaveURL(/\/client$/)
    await expect(clientPage.getByText(trainer.name).first()).toBeVisible()
  })

  test('check-in form shows validation errors', async () => {
    await clientPage.goto('/client/check-in')
    await clientPage.getByTestId('checkin-submit').click()
    await expect(clientPage.getByText('Please fix the highlighted fields.').first()).toBeVisible()
    await expect(clientPage.getByText('This field is required.')).toBeVisible()
    await expect(clientPage.getByText('Choose a value between 1 and 5.').first()).toBeVisible()
  })

  test('client submits a check-in and the trainer sees it live on another device', async () => {
    await trainerPage.goto('/trainer')
    await expect(trainerPage.getByTestId('stat-0')).toContainText('1')
    await expect(trainerPage.getByText('No check-ins yet.')).toBeVisible()

    const form = clientPage.getByTestId('checkin-form')
    // Tap the visible scale buttons like a user would (no force).
    for (const [name, v] of [['sleep', 4], ['energy', 2], ['mental', 3], ['soreness', 6], ['pain', 5]] as const) {
      await form.getByTestId(`${name}-${v}`).click()
      await expect(form.locator(`input[name="${name}"][value="${v}"]`)).toBeChecked()
    }
    await clientPage.getByText('Left knee').click()
    await expect(clientPage.getByRole('note')).toContainText('significant pain')
    await form.locator('textarea[name="goal"]').fill(`Squat technique ${id}`)
    await clientPage.getByTestId('checkin-submit').click()
    await expect(clientPage.getByTestId('checkin-done')).toBeVisible()

    // No reload on the trainer device — realtime must deliver it.
    const recent = trainerPage.getByTestId('recent-checkins')
    await expect(recent).toContainText(client.name, { timeout: 15_000 })
    await expect(recent).toContainText('5/10')
    await expect(trainerPage.getByTestId('stat-2')).toContainText('1')
    await expect(trainerPage.getByText('Reported pain 5/10')).toBeVisible()
  })

  test('trainer reviews, logs a session with exercises and a shared note', async () => {
    await trainerPage.getByTestId('mark-reviewed').first().click()
    await expect(trainerPage.getByText('Reviewed').first()).toBeVisible()

    await trainerPage.goto('/trainer/clients')
    await trainerPage.getByTestId('client-search').fill(id)
    await trainerPage.getByRole('link', { name: 'View details' }).click()
    await expect(trainerPage.getByTestId('client-name')).toHaveText(client.name)

    await trainerPage.getByTestId('new-session').click()
    const form = trainerPage.getByTestId('session-form')
    const past = new Date(Date.now() - 2 * 3600_000)
    const pad = (n: number) => String(n).padStart(2, '0')
    await form.getByLabel('Date & time').fill(`${past.getFullYear()}-${pad(past.getMonth() + 1)}-${pad(past.getDate())}T${pad(past.getHours())}:${pad(past.getMinutes())}`)
    await form.getByLabel('Title').fill(`Lower body ${id}`)
    await form.getByLabel('Status').selectOption('completed')
    await form.getByLabel('Exercise 1').fill('Back squat')
    await form.getByLabel('Sets').fill('5')
    await form.getByLabel('Reps').fill('five')
    await trainerPage.getByTestId('session-save').click()
    await expect(form.getByText('Enter a whole number.')).toBeVisible()
    await form.getByLabel('Reps').fill('5')
    await form.getByLabel('Weight (kg)').fill('82.5')
    await trainerPage.getByTestId('session-save').click()
    await expect(trainerPage.getByText('Session saved.')).toBeVisible()

    const noteForm = trainerPage.getByTestId('note-form')
    await noteForm.locator('textarea[name="note-body"]').fill(`Great depth today ${id}`)
    await trainerPage.getByTestId('visibility-shared').click()
    await trainerPage.getByTestId('note-save').click()
    await expect(trainerPage.getByText('Note saved.')).toBeVisible()
  })

  test('client sees the shared note and session, leaves feedback; data persists after reload', async () => {
    await clientPage.goto('/client/history')
    const timeline = clientPage.getByTestId('timeline')
    await expect(timeline).toContainText(`Great depth today ${id}`)
    await expect(timeline).toContainText(`Lower body ${id}`)
    await expect(timeline).toContainText('Back squat')

    await clientPage.getByTestId('give-feedback').click()
    await clientPage.getByTestId('feedback-submit').click()
    await expect(clientPage.getByText('Choose a value between 1 and 10.')).toBeVisible()
    const fb = clientPage.getByTestId('feedback-form')
    await fb.getByTestId('rpe-7').click()
    await fb.getByTestId('enjoyment-4').click()
    await fb.getByTestId('fpain-1').click()
    const resP = clientPage.waitForResponse((r) => r.url().includes('post_session_feedback') && r.request().method() !== 'GET')
    await clientPage.getByTestId('feedback-submit').click()
    const res = await resP
    expect(res.status(), await res.text()).toBeLessThan(300)
    await expect(clientPage.getByText('Feedback sent.')).toBeVisible()

    await clientPage.reload()
    await expect(clientPage.getByText('RPE 7/10')).toBeVisible()

    await trainerPage.reload()
    await trainerPage.getByRole('tab', { name: 'Sessions' }).click()
    await expect(trainerPage.getByText('RPE 7/10')).toBeVisible()
    await expect(trainerPage.getByText('82.5')).toBeVisible()
  })

  test('client revokes sharing; trainer health tab shows "Not shared"', async () => {
    await clientPage.goto('/client/settings')
    const box = clientPage.getByTestId('sharing-trainer')
    await expect(box).toContainText(trainer.name)
    await box.getByRole('switch', { name: `${trainer.name}: HRV` }).click()
    await expect(clientPage.getByText('Sharing updated.')).toBeVisible()
    await expect(box.getByRole('switch', { name: `${trainer.name}: HRV` })).toHaveAttribute('aria-checked', 'false')

    await trainerPage.getByRole('tab', { name: 'Health' }).click()
    await expect(trainerPage.getByText('No Apple Health data yet')).toBeVisible()
  })

  test('language switches instantly without reload and persists', async () => {
    await trainerPage.goto('/trainer')
    await trainerPage.getByTestId('lang-switch').click()
    await trainerPage.getByRole('menuitemradio', { name: '简体中文' }).click()
    await expect(trainerPage.getByRole('heading', { name: `你好，${trainer.name}` })).toBeVisible()
    await expect(trainerPage.locator('html')).toHaveAttribute('lang', 'zh-CN')
    await trainerPage.reload()
    await expect(trainerPage.getByText('待查看问卷')).toBeVisible()
    await trainerPage.getByTestId('lang-switch').click()
    await trainerPage.getByRole('menuitemradio', { name: 'English' }).click()
    await expect(trainerPage.getByText('Check-ins to review')).toBeVisible()
  })

  test('theme toggles between light and dark', async () => {
    await trainerPage.getByTestId('theme-switch').click()
    await trainerPage.getByRole('menuitemradio', { name: 'Dark' }).click()
    await expect(trainerPage.locator('html')).toHaveAttribute('data-theme', 'dark')
    await trainerPage.reload()
    await expect(trainerPage.locator('html')).toHaveAttribute('data-theme', 'dark')
    await trainerPage.getByTestId('theme-switch').click()
    await trainerPage.getByRole('menuitemradio', { name: 'Light' }).click()
    await expect(trainerPage.locator('html')).toHaveAttribute('data-theme', 'light')
  })

  test('sign out returns to the landing page and protects routes', async () => {
    await trainerPage.getByTestId('sign-out').click()
    await expect(trainerPage).toHaveURL('/')
    await expect(trainerPage.getByText('You have been signed out.')).toBeVisible()
    await trainerPage.goto('/trainer/clients')
    await expect(trainerPage).toHaveURL(/\/auth\/trainer\?next=/)
  })
})

test('sign-in shows a clear error for wrong credentials', async ({ page }) => {
  await page.goto('/auth/client')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByText('Enter a valid email address.')).toBeVisible()
  await page.getByLabel('Email').fill(`nobody-${uid()}@e2e.test`)
  await page.getByLabel('Password').fill('wrong-password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByTestId('form-error')).toHaveText('Email or password is incorrect.')
})

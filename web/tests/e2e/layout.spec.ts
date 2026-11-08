import { expect, test } from '@playwright/test'

/** Visual-regression guards for layout bugs found during development. */
test('session card: edit button never overlaps the status badge (any width) @mobile', async ({ page }) => {
  await page.addInitScript(() => { if (!localStorage.getItem('fitcheckin.lang')) localStorage.setItem('fitcheckin.lang', 'zh-CN') })
  await page.goto('/auth?demo=1')
  await page.getByTestId('create-demo').click()
  await page.getByTestId('demo-signin-trainer').click()
  await expect(page).toHaveURL(/\/trainer$/)

  for (const width of [320, 390, 509, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/trainer/sessions')
    const card = page.getByTestId('session-card').first()
    await expect(card).toBeVisible()
    const edit = await card.getByTestId('edit-session').boundingBox()
    for (const badge of await card.locator('header span.rounded-full').all()) {
      const b = (await badge.boundingBox())!
      const overlaps = !(edit!.x + edit!.width <= b.x || b.x + b.width <= edit!.x || edit!.y + edit!.height <= b.y || b.y + b.height <= edit!.y)
      expect(overlaps, `edit button overlaps badge at ${width}px`).toBe(false)
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), `horizontal overflow at ${width}px`).toBe(0)
  }
})

test('text colour utilities apply to buttons (base styles must stay in @layer base)', async ({ page }) => {
  await page.goto('/')
  // Compare a .text-bad button with a reference element coloured var(--bad).
  const probe = await page.evaluate(() => {
    const ref = document.createElement('span'); ref.style.color = 'var(--bad)'; document.body.append(ref)
    const btn = document.createElement('button'); btn.className = 'text-bad'; document.body.append(btn)
    return [getComputedStyle(ref).color, getComputedStyle(btn).color]
  })
  expect(probe[1]).toBe(probe[0])
})

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  test(`sharing switch: knob stays inside the track and reflects state (reducedMotion=${reducedMotion})`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion })
    await page.goto('/auth?demo=1')
    await page.getByTestId('create-demo').click()
    await page.getByTestId('demo-signin-client').click()
    await expect(page).toHaveURL(/\/client$/)
    await page.goto('/client/settings')

    const sw = page.getByTestId('sharing-trainer').first().getByRole('switch').last() // body measurements
    await expect(sw).toBeVisible()

    const geometry = async () => {
      const track = (await sw.boundingBox())!
      const knob = (await sw.locator('span').boundingBox())!
      return { track, knob }
    }
    const check = async (on: boolean) => {
      await expect(sw).toHaveAttribute('aria-checked', String(on))
      await expect(sw).not.toHaveAttribute('aria-busy', 'true')
      await page.waitForTimeout(300) // let the 200ms knob transition settle
      const { track, knob } = await geometry()
      expect(knob.x).toBeGreaterThanOrEqual(track.x)
      expect(knob.x + knob.width).toBeLessThanOrEqual(track.x + track.width + 0.5)
      const knobCentre = knob.x + knob.width / 2 - track.x
      if (on) expect(knobCentre).toBeGreaterThan(track.width / 2)
      else expect(knobCentre).toBeLessThan(track.width / 2)
    }

    const initial = (await sw.getAttribute('aria-checked')) === 'true'
    await check(initial)
    await sw.click()
    await check(!initial)
    await page.reload()
    await check(!initial) // persisted server-side
    await sw.click()
    await check(initial)
  })
}

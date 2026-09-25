import { expect, test } from '@playwright/test'

import { ensureData } from './fixtures'

test.beforeAll(async ({ request }) => ensureData(request))

test('dragging a card with the mouse changes its status', async ({ page, request }) => {
  const created = await (
    await request.post('/api/applications', {
      headers: { 'X-Requested-With': 'jobtracker' },
      data: { company: 'Drag Me Inc', job_title: 'Engineer' },
    })
  ).json()
  await page.goto('/applications')
  await page.getByRole('radio', { name: 'Board view' }).click()
  const board = page.getByRole('region', { name: 'Application board' })
  const card = board.getByText('Drag Me Inc')
  const target = board.getByRole('region', { name: /^Recruiter Screen, / })

  // Grab the card body (not the handle) and move past dnd-kit's 6px threshold.
  const from = (await card.boundingBox())!
  const to = (await target.boundingBox())!
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(from.x + from.width / 2 + 12, from.y + 20, { steps: 4 })
  await page.mouse.move(to.x + to.width / 2, to.y + 80, { steps: 12 })
  await page.mouse.up()

  await expect(page.getByText('Moved Drag Me Inc to Recruiter Screen')).toBeVisible()
  const detail = await (await request.get(`/api/applications/${created.id}`)).json()
  expect(detail.status).toBe('screening')
  expect(detail.history.at(-1)).toMatchObject({ from_status: 'applied', to_status: 'screening' })
})

test.describe('phone width', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  for (const path of [
    '/',
    '/applications',
    '/applications/1',
    '/documents',
    '/metrics',
    '/settings',
  ]) {
    test(`${path} fits without sideways scrolling`, async ({ page }) => {
      await page.goto(path)
      await expect(page.locator('#main')).toBeVisible()
      await page.waitForLoadState('networkidle')
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      )
      expect(overflow).toBeLessThanOrEqual(0)
    })
  }
})

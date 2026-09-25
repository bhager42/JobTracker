import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

import { ensureData } from './fixtures'

/**
 * Automated accessibility pass: WCAG 2.2 A/AA rules on every page, in light and dark, with
 * dialogs and menus open.
 */
async function audit(page: Page, label: string) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()
  const problems = results.violations.map(
    (v) => `${label}: ${v.id} (${v.impact}) ${v.help} — ${v.nodes.map((n) => n.target).join(', ')}`,
  )
  expect(problems, problems.join('\n')).toEqual([])
}

test.beforeAll(async ({ request }) => ensureData(request))

const PAGES: [string, string, (page: Page) => Promise<void>][] = [
  ['/', 'dashboard', (p) => expect(p.getByRole('region', { name: 'Key numbers' })).toBeVisible()],
  ['/applications', 'applications', (p) => expect(p.getByRole('table')).toBeVisible()],
  ['/applications/1', 'detail', (p) => expect(p.getByRole('heading', { level: 1 })).toBeVisible()],
  [
    '/documents',
    'documents',
    (p) => expect(p.getByRole('list', { name: 'Document library' })).toBeVisible(),
  ],
  [
    '/metrics',
    'metrics',
    (p) => expect(p.locator('.recharts-bar-rectangle').first()).toBeVisible(),
  ],
  [
    '/settings',
    'settings',
    (p) => expect(p.getByText('Auto-close', { exact: true })).toBeVisible(),
  ],
]

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`${scheme} theme`, () => {
    test.use({ colorScheme: scheme })

    for (const [path, label, ready] of PAGES) {
      test(`${label} has no WCAG A/AA violations`, async ({ page }) => {
        await page.goto(path)
        await ready(page)
        await page.waitForTimeout(400) // let enter animations settle
        await audit(page, `${scheme} ${label}`)
      })
    }
  })
}

test('dialogs, the board, and the palette pass too', async ({ page }) => {
  await page.goto('/applications')
  await page.getByRole('button', { name: 'New application' }).first().click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.waitForTimeout(300)
  await audit(page, 'quick add')
  await page.keyboard.press('Escape')

  await page.getByRole('radio', { name: 'Board view' }).click()
  await expect(page.getByRole('region', { name: 'Application board' })).toBeVisible()
  await audit(page, 'board')

  await page.keyboard.press('Control+k')
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.waitForTimeout(300)
  await audit(page, 'palette')
})

test('keyboard: skip link, visible focus, and Tab reaches the main actions', async ({ page }) => {
  await page.goto('/applications')
  await expect(page.getByRole('table')).toBeVisible()
  await page.keyboard.press('Tab')
  const skip = page.getByRole('link', { name: 'Skip to content' })
  await expect(skip).toBeFocused()
  await expect(skip).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(page.locator('#main')).toBeFocused()
  // From main content, Tab lands on the page's first control, with a visible focus ring.
  await page.keyboard.press('Tab')
  const focused = page.locator(':focus')
  await expect(focused).toBeVisible()
  const ring = await focused.evaluate((el) => {
    const s = getComputedStyle(el)
    return s.outlineStyle !== 'none' || s.boxShadow !== 'none'
  })
  expect(ring).toBe(true)
})

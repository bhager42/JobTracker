import { expect, test } from '@playwright/test'

import { resumePdf, spoofedPdf } from './fixtures'

test.describe.configure({ mode: 'serial' })

test('add an application, attach a resume, change status, and see it in metrics', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))

  // Add.
  await page.goto('/applications')
  await expect(page.getByText('No applications yet')).toBeVisible()
  await page.getByRole('button', { name: 'New application' }).first().click()
  const dialog = page.getByRole('dialog', { name: 'New application' })
  await dialog.getByLabel('Company').fill('Acme Robotics')
  await dialog.getByLabel('Job title').fill('Backend Engineer')
  await dialog.getByLabel('Job posting URL').fill('https://acme.example/jobs/42')
  await dialog.getByRole('button', { name: 'Add application' }).click()
  await expect(dialog).toBeHidden()
  await page.getByRole('link', { name: 'Acme Robotics' }).click()
  await expect(page.getByRole('heading', { name: 'Acme Robotics' })).toBeVisible()

  // Attach a resume: upload it straight from the Attach dialog.
  await page.getByRole('button', { name: 'Attach' }).click()
  const attach = page.getByRole('dialog', { name: 'Attach documents' })
  await attach.locator('input[type=file]').setInputFiles(resumePdf)
  await expect(attach.getByLabel('Jane Doe – Resume')).toBeChecked()
  await attach.getByRole('button', { name: /Save \(1 attached\)/ }).click()
  await expect(attach).toBeHidden()
  const attached = page.getByRole('list', { name: 'Attached documents' })
  await expect(attached).toContainText('Jane Doe – Resume')

  // Change status, with a note that shows up in the timeline.
  await page.getByRole('button', { name: 'Change status' }).click()
  const change = page.getByRole('dialog', { name: 'Change status' })
  await change.getByRole('combobox', { name: 'Status' }).click()
  await page.getByRole('option', { name: 'Interviewing' }).click()
  await change.getByLabel('Interview rounds reached').fill('1')
  await change.getByLabel('Note').fill('Onsite next week')
  await change.getByRole('button', { name: 'Save' }).click()
  await expect(change).toBeHidden()
  const timeline = page.getByRole('list', { name: 'Status history' })
  await expect(timeline).toContainText('Onsite next week')
  await expect(timeline.getByRole('listitem')).toHaveCount(2)

  // View metrics.
  await page.getByRole('link', { name: 'Metrics' }).click()
  const kpis = page.getByRole('region', { name: 'Key numbers' })
  await expect(kpis).toContainText('Applied1')
  await expect(kpis).toContainText('Interview rate100%')
  await expect(page.locator('.recharts-bar-rectangle').first()).toBeVisible()

  expect(errors).toEqual([])
})

test('a file whose contents do not match its extension is rejected', async ({ page, request }) => {
  const count = async () => (await (await request.get('/api/documents')).json()).length
  const before = await count()
  await page.goto('/documents')
  await page.locator('input[type=file]').setInputFiles(spoofedPdf)
  await expect(
    page.getByText("totally-a-resume.pdf: The file's contents don't match its .pdf extension."),
  ).toBeVisible()
  expect(await count()).toBe(before)
})

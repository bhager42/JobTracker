import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { makeApplication, makeDocument, page, renderApp } from '@/test/render-app'

const problem = (status: number, body: object) =>
  Response.json(
    { type: 'about:blank', title: 'Error', status, ...body },
    { status, headers: { 'content-type': 'application/problem+json' } },
  )

describe('Documents page', () => {
  test('lists the library with usage counts', async () => {
    renderApp('/documents', {
      'GET /api/documents': () =>
        Response.json([
          makeDocument({ display_name: 'Resume – Backend', application_count: 3 }),
          makeDocument({
            display_name: 'Letter – Acme',
            kind: 'cover_letter',
            mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            original_filename: 'letter.docx',
          }),
        ]),
    })
    const list = await screen.findByRole('list', { name: 'Document library' })
    const rows = within(list).getAllByRole('listitem')
    expect(rows[0]).toHaveTextContent('Resume – Backend')
    expect(rows[0]).toHaveTextContent('Used in 3 applications')
    expect(rows[1]).toHaveTextContent('Cover letter')
    expect(rows[1]).toHaveTextContent('DOCX')
    expect(rows[1]).toHaveTextContent('Not used yet')
  })

  test('uploads a dropped-in file as multipart with the chosen kind', async () => {
    const user = userEvent.setup()
    const { api } = renderApp('/documents', {
      'GET /api/documents': () => Response.json([]),
      'POST /api/documents': () =>
        Response.json(
          { ...makeDocument({ display_name: 'cv' }), duplicate: false },
          { status: 201 },
        ),
    })
    await screen.findByText('No documents yet')
    const input = document.querySelector('input[type=file]') as HTMLInputElement
    await user.upload(input, new File(['%PDF-1.4'], 'cv.pdf', { type: 'application/pdf' }))

    await waitFor(() => expect(api.calls.some((c) => c.method === 'POST')).toBe(true))
    const form = api.calls.find((c) => c.method === 'POST')!.req.body as FormData
    expect((form.get('file') as File).name).toBe('cv.pdf')
    expect(form.get('kind')).toBe('resume')
    expect(await screen.findByText('Uploaded cv')).toBeInTheDocument()
  })

  test('refuses disallowed file types before uploading', async () => {
    const user = userEvent.setup({ applyAccept: false })
    const { api } = renderApp('/documents', { 'GET /api/documents': () => Response.json([]) })
    await screen.findByText('No documents yet')
    const input = document.querySelector('input[type=file]') as HTMLInputElement
    await user.upload(input, new File(['x'], 'photo.png', { type: 'image/png' }))
    expect(await screen.findByText(/photo\.png: only PDF/)).toBeInTheDocument()
    expect(api.calls.some((c) => c.method === 'POST')).toBe(false)
  })

  test('shows server rejections such as a spoofed file', async () => {
    const user = userEvent.setup()
    renderApp('/documents', {
      'GET /api/documents': () => Response.json([]),
      'POST /api/documents': () =>
        problem(415, { detail: "The file's contents don't match its .pdf extension." }),
    })
    await screen.findByText('No documents yet')
    const input = document.querySelector('input[type=file]') as HTMLInputElement
    await user.upload(input, new File(['MZ'], 'resume.pdf'))
    expect(
      await screen.findByText("resume.pdf: The file's contents don't match its .pdf extension."),
    ).toBeInTheDocument()
  })

  test('deleting a linked document explains which applications use it', async () => {
    const user = userEvent.setup()
    const doc = makeDocument({ display_name: 'Resume v3', application_count: 1 })
    renderApp('/documents', {
      'GET /api/documents': () => Response.json([doc]),
      'DELETE /api/documents/:id': () =>
        problem(409, {
          detail: 'attached',
          applications: [{ id: 7, company: 'Acme', job_title: 'Backend Engineer' }],
        }),
    })
    await user.click(await screen.findByRole('button', { name: 'Actions for Resume v3' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete' }),
    )
    const dialog = await screen.findByRole('dialog', { name: 'Still attached' })
    expect(within(dialog).getByRole('link', { name: 'Acme' })).toHaveAttribute(
      'href',
      '/applications/7',
    )
  })

  test('PDF preview frames the inline file without an iframe sandbox attribute', async () => {
    const user = userEvent.setup()
    const doc = makeDocument({ display_name: 'Resume v3' })
    renderApp('/documents', { 'GET /api/documents': () => Response.json([doc]) })
    await user.click(await screen.findByRole('button', { name: 'Resume v3' }))
    const frame = await screen.findByTitle('Preview of Resume v3')
    expect(frame).toHaveAttribute('src', `/api/documents/${doc.id}/file?disposition=inline`)
    // Chrome won't render PDFs in a sandboxed iframe; the server's CSP sandbox header does it.
    expect(frame).not.toHaveAttribute('sandbox')
  })
})

describe('Attaching documents', () => {
  test('the detail page attaches library documents with a PUT', async () => {
    const user = userEvent.setup()
    const resume = makeDocument({ display_name: 'Resume v3' })
    const letter = makeDocument({ display_name: 'Letter – Acme', kind: 'cover_letter' })
    let app = makeApplication({ documents: [resume] })
    const { api } = renderApp(`/applications/${app.id}`, {
      'GET /api/applications/:id': () => Response.json(app),
      'GET /api/documents': () => Response.json([resume, letter]),
      'PUT /api/applications/:id/documents': ({ body }) => {
        const ids = (body as { document_ids: number[] }).document_ids
        app = { ...app, documents: [resume, letter].filter((d) => ids.includes(d.id)) }
        return Response.json(app)
      },
    })
    const attached = await screen.findByRole('list', { name: 'Attached documents' })
    expect(attached).toHaveTextContent('Resume v3')

    await user.click(screen.getByRole('button', { name: 'Attach' }))
    const dialog = await screen.findByRole('dialog', { name: 'Attach documents' })
    expect(within(dialog).getByLabelText('Resume v3')).toBeChecked()
    await user.click(await within(dialog).findByLabelText('Letter – Acme'))
    await user.click(within(dialog).getByRole('button', { name: 'Save (2 attached)' }))

    await waitFor(() =>
      expect(api.calls.find((c) => c.method === 'PUT')?.req.body).toEqual({
        document_ids: [resume.id, letter.id],
      }),
    )
    await waitFor(() => expect(attached).toHaveTextContent('Letter – Acme'))
  })

  test('detaching sends the remaining ids', async () => {
    const user = userEvent.setup()
    const resume = makeDocument({ display_name: 'Resume v3' })
    const app = makeApplication({ documents: [resume] })
    const { api } = renderApp(`/applications/${app.id}`, {
      'GET /api/applications/:id': () => Response.json(app),
      'PUT /api/applications/:id/documents': () => Response.json({ ...app, documents: [] }),
    })
    await user.click(await screen.findByRole('button', { name: 'Detach Resume v3' }))
    await waitFor(() =>
      expect(api.calls.find((c) => c.method === 'PUT')?.req.body).toEqual({ document_ids: [] }),
    )
  })

  test('quick add sends the picked resume with the new application', async () => {
    const user = userEvent.setup()
    const resume = makeDocument({ display_name: 'Resume v3' })
    const { api } = renderApp('/applications', {
      'GET /api/applications': () => page([]),
      'GET /api/documents': () => Response.json([resume]),
      'POST /api/applications': () =>
        Response.json(makeApplication({ company: 'Initech' }), { status: 201 }),
    })
    await screen.findByText('No applications yet')
    await user.click(screen.getAllByRole('button', { name: 'New application' })[0]!)
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Company'), 'Initech')
    await user.type(within(dialog).getByLabelText('Job title'), 'Engineer')
    await user.click(within(dialog).getByRole('combobox', { name: 'Resume' }))
    await user.click(await screen.findByRole('option', { name: 'Resume v3' }))
    await user.click(within(dialog).getByRole('button', { name: 'Add application' }))

    await waitFor(() =>
      expect(api.calls.find((c) => c.method === 'POST')?.req.body).toMatchObject({
        company: 'Initech',
        document_ids: [resume.id],
      }),
    )
  })
})

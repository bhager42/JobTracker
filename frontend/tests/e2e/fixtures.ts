import type { APIRequestContext } from '@playwright/test'

/** Small but valid files for upload tests. */

function pdf(text: string): Buffer {
  const stream = `BT /F1 24 Tf 72 700 Td (${text}) Tj ET`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let out = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((body, i) => {
    offsets.push(out.length)
    out += `${i + 1} 0 obj\n${body}\nendobj\n`
  })
  const xref = out.length
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(out, 'latin1')
}

export const resumePdf = {
  name: 'Jane Doe – Resume.pdf',
  mimeType: 'application/pdf',
  buffer: pdf('Jane Doe - Backend Resume'),
}

/** A long filename, to check it stays inside its field. */
export const longNameResumePdf = {
  name: 'Jane_Doe_Senior_Backend_Engineer_Resume_Final_Version_October_2026_Updated.pdf',
  mimeType: 'application/pdf',
  buffer: pdf('Jane Doe - Senior Backend Resume'),
}

/** An executable renamed to .pdf: must be rejected by content, not extension. */
export const spoofedPdf = {
  name: 'totally-a-resume.pdf',
  mimeType: 'application/pdf',
  buffer: Buffer.from('MZ\x90\x00\x03 this is not a pdf', 'latin1'),
}

const HEADERS = { 'X-Requested-With': 'jobtracker' }

/** Makes sure there's at least one application and one document, so every page has content
 * even when a spec runs on its own. */
export async function ensureData(request: APIRequestContext) {
  const apps = await (await request.get('/api/applications')).json()
  if (apps.total === 0) {
    await request.post('/api/applications', {
      headers: HEADERS,
      data: { company: 'Seed Co', job_title: 'Engineer', source: 'referral' },
    })
  }
  const docs = await (await request.get('/api/documents')).json()
  if (docs.length === 0) {
    await request.post('/api/documents', {
      headers: HEADERS,
      multipart: { file: resumePdf, kind: 'resume' },
    })
  }
}

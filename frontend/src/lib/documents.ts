/** Client-side helpers for documents. The server re-checks everything by file content. */

export const ACCEPTED_EXTENSIONS = ['.pdf', '.docx', '.doc', '.odt', '.rtf', '.txt', '.md']
export const ACCEPT_ATTRIBUTE = ACCEPTED_EXTENSIONS.join(',')
export const ACCEPTED_LABEL = 'PDF, DOCX, DOC, ODT, RTF, TXT, or Markdown'

export function hasAcceptedExtension(name: string): boolean {
  const lower = name.toLowerCase()
  return ACCEPTED_EXTENSIONS.some((ext) => lower.endsWith(ext)) || lower.endsWith('.markdown')
}

export function isPdf(mimeType: string): boolean {
  return mimeType === 'application/pdf'
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** A short type label from the stored MIME type, e.g. "PDF" or "DOCX". */
export function fileTypeLabel(mimeType: string): string {
  const map: Record<string, string> = {
    'application/pdf': 'PDF',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
    'application/msword': 'DOC',
    'application/vnd.oasis.opendocument.text': 'ODT',
    'application/rtf': 'RTF',
  }
  const base = mimeType.split(';')[0]!.trim()
  if (map[base]) return map[base]
  if (base === 'text/markdown') return 'MD'
  if (base === 'text/plain') return 'TXT'
  return 'File'
}

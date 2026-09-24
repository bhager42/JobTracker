import { Download } from 'lucide-react'

import { documentFileUrl, type Document } from '@/api/documents'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { formatBytes } from '@/lib/documents'

/**
 * Inline PDF preview. The server sends the PDF with `Content-Security-Policy: sandbox`, which
 * sandboxes the framed document. The iframe deliberately has no `sandbox` attribute: Chrome
 * refuses to run its PDF viewer inside one and shows a broken page instead.
 */
export function DocumentPreviewDialog({
  document,
  onOpenChange,
}: {
  document: Document | null
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={document !== null} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[90vh] flex-col gap-3 sm:max-w-4xl">
        {document && (
          <>
            <DialogHeader className="flex-row items-center justify-between gap-4 pr-8">
              <div className="min-w-0">
                <DialogTitle className="truncate">{document.display_name}</DialogTitle>
                <DialogDescription className="truncate">
                  {document.original_filename} · {formatBytes(document.size_bytes)}
                </DialogDescription>
              </div>
              <Button variant="outline" size="sm" asChild>
                <a href={documentFileUrl(document.id, 'attachment')} download>
                  <Download data-icon="inline-start" />
                  Download
                </a>
              </Button>
            </DialogHeader>
            <iframe
              title={`Preview of ${document.display_name}`}
              src={documentFileUrl(document.id, 'inline')}
              className="min-h-0 w-full flex-1 rounded-lg border bg-muted"
            />
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

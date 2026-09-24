import { Download, Eye, FileText, Paperclip, Search, X } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import type { ApplicationDetail } from '@/api/applications'
import {
  documentFileUrl,
  useDocuments,
  useSetApplicationDocuments,
  type Document,
} from '@/api/documents'
import { DocumentDropzone } from '@/components/document-dropzone'
import { DocumentPreviewDialog } from '@/components/document-preview-dialog'
import { EnumSelect } from '@/components/enum-select'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useUploadFiles } from '@/hooks/use-upload-files'
import { fileTypeLabel, formatBytes, isPdf } from '@/lib/documents'
import { DOCUMENT_KIND_LABELS, type DocumentKind } from '@/lib/enums'

/** The documents sent with an application: preview, download, detach, and attach more. */
export function ApplicationDocumentsCard({ app }: { app: ApplicationDetail }) {
  const setDocs = useSetApplicationDocuments(app.id)
  const [attachOpen, setAttachOpen] = useState(false)
  const [preview, setPreview] = useState<Document | null>(null)
  const ids = app.documents.map((d) => d.id)

  const save = async (next: number[], message: string) => {
    try {
      await setDocs.mutateAsync(next)
      toast.success(message)
      return true
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update documents')
      return false
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Documents</CardTitle>
        <Button variant="outline" size="sm" type="button" onClick={() => setAttachOpen(true)}>
          <Paperclip data-icon="inline-start" />
          Attach
        </Button>
      </CardHeader>
      <CardContent>
        {app.documents.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No documents attached. Attach the resume and cover letter you sent.
          </p>
        ) : (
          <ul className="grid gap-2" aria-label="Attached documents">
            {app.documents.map((doc) => (
              <li key={doc.id} className="flex items-center gap-3 rounded-lg border px-3 py-2">
                <FileText className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{doc.display_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {DOCUMENT_KIND_LABELS[doc.kind]} · {fileTypeLabel(doc.mime_type)} ·{' '}
                    {formatBytes(doc.size_bytes)}
                  </p>
                </div>
                {isPdf(doc.mime_type) && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Preview ${doc.display_name}`}
                    onClick={() => setPreview(doc)}
                  >
                    <Eye />
                  </Button>
                )}
                <Button variant="ghost" size="icon-sm" asChild>
                  <a
                    href={documentFileUrl(doc.id, 'attachment')}
                    download
                    aria-label={`Download ${doc.display_name}`}
                  >
                    <Download />
                  </a>
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Detach ${doc.display_name}`}
                  disabled={setDocs.isPending}
                  onClick={() =>
                    void save(
                      ids.filter((id) => id !== doc.id),
                      `Detached ${doc.display_name}`,
                    )
                  }
                >
                  <X />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <AttachDialog
        open={attachOpen}
        onOpenChange={setAttachOpen}
        attachedIds={ids}
        pending={setDocs.isPending}
        onSave={async (next) => {
          if (await save(next, 'Documents updated')) setAttachOpen(false)
        }}
      />
      <DocumentPreviewDialog
        document={preview}
        onOpenChange={(open) => !open && setPreview(null)}
      />
    </Card>
  )
}

function AttachDialog({
  open,
  onOpenChange,
  attachedIds,
  pending,
  onSave,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  attachedIds: number[]
  pending: boolean
  onSave: (ids: number[]) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Attach documents</DialogTitle>
          <DialogDescription>
            Pick from your library, or upload a new file to add and attach it.
          </DialogDescription>
        </DialogHeader>
        {open && <AttachForm attachedIds={attachedIds} pending={pending} onSave={onSave} />}
      </DialogContent>
    </Dialog>
  )
}

function AttachForm({
  attachedIds,
  pending,
  onSave,
}: {
  attachedIds: number[]
  pending: boolean
  onSave: (ids: number[]) => void
}) {
  const [selected, setSelected] = useState<number[]>(attachedIds)
  const [q, setQ] = useState('')
  const [uploadKind, setUploadKind] = useState<DocumentKind>('resume')
  const { data = [] } = useDocuments()
  const { uploadFiles, isUploading } = useUploadFiles()

  const needle = q.trim().toLowerCase()
  const visible = needle
    ? data.filter(
        (d) =>
          d.display_name.toLowerCase().includes(needle) ||
          d.original_filename.toLowerCase().includes(needle),
      )
    : data
  const toggle = (id: number, on: boolean) =>
    setSelected((prev) => (on ? [...prev, id] : prev.filter((x) => x !== id)))

  return (
    <div className="grid gap-4">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          aria-label="Search library"
          placeholder="Search library…"
          className="pl-8"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <ScrollArea className="h-56 rounded-lg border">
        {visible.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">
            {data.length === 0 ? 'Your library is empty. Upload a file below.' : 'No matches.'}
          </p>
        ) : (
          <fieldset className="grid gap-0.5 p-1">
            <legend className="sr-only">Library documents</legend>
            {visible.map((doc) => (
              <div
                key={doc.id}
                className="flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-muted"
              >
                <Checkbox
                  id={`attach-${doc.id}`}
                  checked={selected.includes(doc.id)}
                  onCheckedChange={(v) => toggle(doc.id, v === true)}
                />
                <Label
                  htmlFor={`attach-${doc.id}`}
                  className="min-w-0 flex-1 cursor-pointer font-normal"
                >
                  <span className="truncate">{doc.display_name}</span>
                </Label>
                <Badge variant="secondary">{DOCUMENT_KIND_LABELS[doc.kind]}</Badge>
              </div>
            ))}
          </fieldset>
        )}
      </ScrollArea>
      <div className="grid gap-2 sm:grid-cols-[1fr_9rem] sm:items-center">
        <DocumentDropzone
          compact
          disabled={isUploading}
          onFiles={async (files) => {
            const added = await uploadFiles(files, uploadKind)
            setSelected((prev) => [...new Set([...prev, ...added.map((d) => d.id)])])
          }}
        />
        <EnumSelect
          aria-label="Upload as"
          labels={DOCUMENT_KIND_LABELS}
          allowEmpty={false}
          value={uploadKind}
          onChange={(v) => v && setUploadKind(v)}
        />
      </div>
      <DialogFooter>
        <Button type="button" disabled={pending || isUploading} onClick={() => onSave(selected)}>
          {pending ? 'Saving…' : `Save (${selected.length} attached)`}
        </Button>
      </DialogFooter>
    </div>
  )
}

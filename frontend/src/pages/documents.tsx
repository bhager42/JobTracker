import { Link } from '@tanstack/react-router'
import { Download, Eye, FileText, MoreHorizontal, Pencil, Search, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import {
  documentFileUrl,
  linkedApplications,
  useDeleteDocument,
  useDocuments,
  useUpdateDocument,
  type Document,
  type LinkedApplication,
} from '@/api/documents'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { DocumentDropzone } from '@/components/document-dropzone'
import { DocumentPreviewDialog } from '@/components/document-preview-dialog'
import { EmptyState } from '@/components/empty-state'
import { EnumSelect } from '@/components/enum-select'
import { FormField } from '@/components/form-field'
import { PageHeader } from '@/components/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useUploadFiles } from '@/hooks/use-upload-files'
import { formatDate } from '@/lib/dates'
import { fileTypeLabel, formatBytes, isPdf } from '@/lib/documents'
import { DOCUMENT_KIND_LABELS, type DocumentKind } from '@/lib/enums'

export function DocumentsPage() {
  const [kind, setKind] = useState<DocumentKind | ''>('')
  const [q, setQ] = useState('')
  const [uploadKind, setUploadKind] = useState<DocumentKind>('resume')
  const { data, isPending, isError, error } = useDocuments({
    kind: kind || undefined,
    q: q.trim() || undefined,
  })
  const { uploadFiles, isUploading } = useUploadFiles()

  const [preview, setPreview] = useState<Document | null>(null)
  const [editing, setEditing] = useState<Document | null>(null)
  const [deleting, setDeleting] = useState<Document | null>(null)
  const [blocked, setBlocked] = useState<{ doc: Document; apps: LinkedApplication[] } | null>(null)
  const remove = useDeleteDocument()

  const doDelete = async (doc: Document) => {
    try {
      await remove.mutateAsync(doc.id)
      toast.success(`Deleted ${doc.display_name}`)
    } catch (err) {
      const apps = linkedApplications(err)
      if (apps) setBlocked({ doc, apps })
      else toast.error(err instanceof Error ? err.message : 'Could not delete')
    }
  }

  const filtered = Boolean(kind || q.trim())

  return (
    <>
      <PageHeader
        title="Documents"
        description="Resumes and cover letters, uploaded once and attached to any application."
      />

      <div className="grid gap-3 rounded-2xl border bg-card p-4 sm:grid-cols-[1fr_auto] sm:items-end">
        <DocumentDropzone
          compact
          disabled={isUploading}
          onFiles={(files) => void uploadFiles(files, uploadKind)}
        />
        <div className="grid gap-1.5 sm:w-44">
          <Label htmlFor="upload-kind">Upload as</Label>
          <EnumSelect
            id="upload-kind"
            labels={DOCUMENT_KIND_LABELS}
            allowEmpty={false}
            value={uploadKind}
            onChange={(v) => v && setUploadKind(v)}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            aria-label="Search documents"
            data-page-search
            placeholder="Search documents…"
            className="pl-8"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <ToggleGroup
          type="single"
          variant="outline"
          value={kind || 'all'}
          onValueChange={(v) => setKind(v === 'all' || v === '' ? '' : (v as DocumentKind))}
          aria-label="Document kind"
        >
          <ToggleGroupItem value="all">All</ToggleGroupItem>
          {Object.entries(DOCUMENT_KIND_LABELS).map(([key, label]) => (
            <ToggleGroupItem key={key} value={key}>
              {label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      {isPending ? (
        <div className="space-y-2" aria-busy="true" aria-label="Loading">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-xl" />
          ))}
        </div>
      ) : isError ? (
        <EmptyState icon={FileText} title="Could not load documents" description={error.message} />
      ) : data.length === 0 ? (
        <EmptyState
          icon={filtered ? Search : FileText}
          title={filtered ? 'No matches' : 'No documents yet'}
          description={
            filtered
              ? 'No documents match this search.'
              : 'Upload a resume or cover letter above, then attach it to applications.'
          }
        />
      ) : (
        <ul className="divide-y rounded-xl border bg-card" aria-label="Document library">
          {data.map((doc) => (
            <DocumentRow
              key={doc.id}
              doc={doc}
              onPreview={() => setPreview(doc)}
              onEdit={() => setEditing(doc)}
              onDelete={() => setDeleting(doc)}
            />
          ))}
        </ul>
      )}

      <DocumentPreviewDialog
        document={preview}
        onOpenChange={(open) => !open && setPreview(null)}
      />
      <EditDocumentDialog document={editing} onOpenChange={(open) => !open && setEditing(null)} />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Delete ${deleting?.display_name ?? 'document'}?`}
        description="This permanently removes the file from your library."
        confirmLabel="Delete"
        onConfirm={() => deleting && void doDelete(deleting)}
      />
      <Dialog open={blocked !== null} onOpenChange={(open) => !open && setBlocked(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Still attached</DialogTitle>
            <DialogDescription>
              “{blocked?.doc.display_name}” is attached to these applications. Detach it from each
              one before deleting it.
            </DialogDescription>
          </DialogHeader>
          <ul className="grid gap-1 text-sm">
            {blocked?.apps.map((app) => (
              <li key={app.id}>
                <Link
                  to="/applications/$id"
                  params={{ id: String(app.id) }}
                  className="font-medium hover:underline"
                >
                  {app.company}
                </Link>{' '}
                <span className="text-muted-foreground">· {app.job_title}</span>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </>
  )
}

function DocumentRow({
  doc,
  onPreview,
  onEdit,
  onDelete,
}: {
  doc: Document
  onPreview: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const pdf = isPdf(doc.mime_type)
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted font-mono text-[10px] font-semibold text-foreground/75">
        {fileTypeLabel(doc.mime_type)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          {pdf ? (
            <button
              type="button"
              onClick={onPreview}
              className="truncate text-left font-medium hover:underline"
            >
              {doc.display_name}
            </button>
          ) : (
            <a
              href={documentFileUrl(doc.id, 'attachment')}
              download
              className="truncate font-medium hover:underline"
            >
              {doc.display_name}
            </a>
          )}
          <Badge variant="secondary">{DOCUMENT_KIND_LABELS[doc.kind]}</Badge>
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {doc.original_filename} · {formatBytes(doc.size_bytes)} · Uploaded{' '}
          {formatDate(doc.uploaded_at)}
        </p>
      </div>
      <p className="hidden shrink-0 text-sm text-muted-foreground tabular-nums sm:block">
        {doc.application_count === 0
          ? 'Not used yet'
          : `Used in ${doc.application_count} application${doc.application_count === 1 ? '' : 's'}`}
      </p>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={`Actions for ${doc.display_name}`}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {pdf && (
            <DropdownMenuItem onSelect={onPreview}>
              <Eye />
              Preview
            </DropdownMenuItem>
          )}
          <DropdownMenuItem asChild>
            <a href={documentFileUrl(doc.id, 'attachment')} download>
              <Download />
              Download
            </a>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onEdit}>
            <Pencil />
            Rename
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={onDelete}>
            <Trash2 />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  )
}

function EditDocumentDialog({
  document,
  onOpenChange,
}: {
  document: Document | null
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={document !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Rename document</DialogTitle>
        </DialogHeader>
        {/* Remount per document so fields start from its values. */}
        {document && (
          <EditDocumentForm
            key={document.id}
            document={document}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function EditDocumentForm({ document, onDone }: { document: Document; onDone: () => void }) {
  const update = useUpdateDocument()
  const [name, setName] = useState(document.display_name)
  const [kind, setKind] = useState<DocumentKind>(document.kind)
  const trimmed = name.trim()

  return (
    <form
      className="grid gap-4"
      onSubmit={async (e) => {
        e.preventDefault()
        if (!trimmed) return
        try {
          await update.mutateAsync({ id: document.id, display_name: trimmed, kind })
          onDone()
        } catch (err) {
          toast.error(err instanceof Error ? err.message : 'Could not save')
        }
      }}
    >
      <FormField
        label="Name"
        htmlFor="doc-name"
        error={trimmed ? undefined : 'Enter a name'}
        hint="Shown in pickers, e.g. “Resume – Backend v3”."
      >
        <Input
          id="doc-name"
          value={name}
          maxLength={200}
          autoFocus
          onChange={(e) => setName(e.target.value)}
        />
      </FormField>
      <FormField label="Kind" htmlFor="doc-kind">
        <EnumSelect
          id="doc-kind"
          labels={DOCUMENT_KIND_LABELS}
          allowEmpty={false}
          value={kind}
          onChange={(v) => v && setKind(v)}
        />
      </FormField>
      <DialogFooter>
        <Button type="submit" disabled={!trimmed || update.isPending}>
          Save
        </Button>
      </DialogFooter>
    </form>
  )
}

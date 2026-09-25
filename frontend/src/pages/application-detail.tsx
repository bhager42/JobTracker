import { zodResolver } from '@hookform/resolvers/zod'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Bot,
  ExternalLink,
  FileQuestion,
  Pencil,
  Trash2,
  Undo2,
} from 'lucide-react'
import { useState } from 'react'
import { Controller, useForm, useWatch, type UseFormReturn } from 'react-hook-form'
import Markdown from 'react-markdown'
import { toast } from 'sonner'

import { ApiError } from '@/api/client'
import {
  useApplication,
  useChangeStatus,
  useDeleteApplication,
  useUndoAutoClose,
  useUpdateApplication,
  type ApplicationDetail,
} from '@/api/applications'
import { ApplicationDocumentsCard } from '@/components/application-documents-card'
import { AutoCloseHint, AutoClosedIcon } from '@/components/auto-close-hint'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { EmptyState } from '@/components/empty-state'
import { EnumSelect } from '@/components/enum-select'
import { FormField } from '@/components/form-field'
import { StatusBadge } from '@/components/status-badge'
import { StatusChangeDialog } from '@/components/status-change-dialog'
import { StatusTimeline } from '@/components/status-timeline'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import {
  applicationFormSchema,
  formFromApplication,
  toUpdateBody,
  type ApplicationFormValues,
} from '@/lib/application-form'
import { errorProps } from '@/lib/aria'
import { formatDate, formatDateTime } from '@/lib/dates'
import { EMPLOYMENT_TYPE_LABELS, SOURCE_LABELS, WORK_MODE_LABELS } from '@/lib/enums'
import { STATUS_META } from '@/lib/status'

export function ApplicationDetailPage() {
  const { id } = useParams({ from: '/applications/$id' })
  const appId = /^\d+$/.test(id) ? Number(id) : NaN
  const { data, isPending, error } = useApplication(appId)

  if (Number.isNaN(appId) || (error instanceof ApiError && error.status === 404)) {
    return (
      <EmptyState
        icon={FileQuestion}
        title="Application not found"
        description="It may have been deleted."
        action={
          <Button variant="outline" asChild>
            <Link to="/applications">Back to applications</Link>
          </Button>
        }
      />
    )
  }
  if (error) {
    return <EmptyState icon={FileQuestion} title="Could not load" description={error.message} />
  }
  if (isPending) return <DetailSkeleton />
  return <Detail app={data} />
}

function Detail({ app }: { app: ApplicationDetail }) {
  const navigate = useNavigate()
  const update = useUpdateApplication(app.id)
  const changeStatus = useChangeStatus(app.id)
  const remove = useDeleteApplication()
  const undo = useUndoAutoClose(app.id)
  const [statusOpen, setStatusOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const form = useForm<ApplicationFormValues>({
    resolver: zodResolver(applicationFormSchema),
    // Follow server updates (e.g. a status change) without clobbering unsaved edits.
    values: formFromApplication(app),
    resetOptions: { keepDirtyValues: true },
  })

  const save = form.handleSubmit(async (values) => {
    try {
      await update.mutateAsync(toUpdateBody(values))
      form.reset(values)
      toast.success('Saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save')
    }
  })

  const toggleArchived = async () => {
    try {
      await update.mutateAsync({ archived: !app.archived })
      toast.success(app.archived ? 'Unarchived' : 'Archived')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update')
    }
  }

  const doUndo = async () => {
    try {
      const restored = await undo.mutateAsync()
      toast.success(`Restored to ${STATUS_META[restored.status].label}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not undo')
    }
  }

  const doDelete = async () => {
    try {
      await remove.mutateAsync(app.id)
      toast.success(`Deleted ${app.company}`)
      await navigate({ to: '/applications' })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete')
    }
  }

  return (
    <>
      <div className="space-y-4">
        <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground" asChild>
          <Link to="/applications">
            <ArrowLeft data-icon="inline-start" />
            Applications
          </Link>
        </Button>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 space-y-1.5">
            <h1 className="text-2xl font-semibold tracking-tight">{app.company}</h1>
            <p className="text-muted-foreground">{app.job_title}</p>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <StatusBadge status={app.status} interviewRounds={app.interview_rounds} />
              {app.auto_closed && <AutoClosedIcon />}
              {app.archived && <Badge variant="secondary">Archived</Badge>}
              <AutoCloseHint autoCloseAt={app.auto_close_at} />
              {app.job_url && (
                <a
                  href={app.job_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground hover:underline"
                >
                  Job posting
                  <ExternalLink className="size-3.5" />
                </a>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setStatusOpen(true)}>Change status</Button>
            <Button variant="outline" onClick={toggleArchived} disabled={update.isPending}>
              {app.archived ? (
                <ArchiveRestore data-icon="inline-start" />
              ) : (
                <Archive data-icon="inline-start" />
              )}
              {app.archived ? 'Unarchive' : 'Archive'}
            </Button>
            <Button
              variant="outline"
              size="icon"
              aria-label="Delete application"
              onClick={() => setDeleteOpen(true)}
            >
              <Trash2 />
            </Button>
          </div>
        </div>
      </div>

      {app.auto_closed && (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-muted/50 px-4 py-3 text-sm"
        >
          <p className="flex items-center gap-2">
            <Bot className="size-4 text-muted-foreground" aria-hidden />
            Closed automatically after no response.{' '}
            <span className="text-muted-foreground">{app.history.at(-1)?.note}</span>
          </p>
          <Button variant="outline" size="sm" onClick={doUndo} disabled={undo.isPending}>
            <Undo2 data-icon="inline-start" />
            Undo
          </Button>
        </div>
      )}

      <form onSubmit={save} noValidate className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <DetailsCard form={form} />
          <NotesCard form={form} />
          <Card>
            <CardHeader>
              <CardTitle>Job description</CardTitle>
            </CardHeader>
            <CardContent>
              <Textarea
                aria-label="Job description"
                placeholder="Paste the posting here. Postings often disappear once filled."
                className="min-h-40 font-mono text-xs"
                {...form.register('job_description')}
              />
            </CardContent>
          </Card>
        </div>
        <div className="space-y-6">
          <ApplicationDocumentsCard app={app} />
          <Card>
            <CardHeader>
              <CardTitle>Timeline</CardTitle>
            </CardHeader>
            <CardContent>
              <StatusTimeline history={app.history} />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="grid gap-2 text-sm">
              <Meta label="Applied" value={formatDate(app.date_applied)} />
              <Meta label="Status changed" value={formatDateTime(app.status_changed_at)} />
              <Meta label="Created" value={formatDateTime(app.created_at)} />
              <Meta label="Updated" value={formatDateTime(app.updated_at)} />
            </CardContent>
          </Card>
        </div>

        {form.formState.isDirty && (
          <div
            role="region"
            aria-label="Unsaved changes"
            className="sticky bottom-4 z-10 flex items-center justify-between gap-3 rounded-xl border bg-background/95 px-4 py-3 shadow-lg backdrop-blur lg:col-span-3"
          >
            <span className="text-sm">You have unsaved changes.</span>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => form.reset(formFromApplication(app))}
              >
                Discard
              </Button>
              <Button type="submit" disabled={update.isPending}>
                {update.isPending ? 'Saving…' : 'Save changes'}
              </Button>
            </div>
          </div>
        )}
      </form>

      <StatusChangeDialog
        open={statusOpen}
        onOpenChange={setStatusOpen}
        initialStatus={app.status}
        initialRounds={app.interview_rounds}
        pending={changeStatus.isPending}
        onSubmit={async (change) => {
          try {
            await changeStatus.mutateAsync(change)
            setStatusOpen(false)
          } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Could not change status')
          }
        }}
      />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Delete ${app.company}?`}
        description="This permanently removes the application and its status history. Archive it instead if you might want it later."
        confirmLabel="Delete"
        onConfirm={doDelete}
      />
    </>
  )
}

function DetailsCard({ form }: { form: UseFormReturn<ApplicationFormValues> }) {
  const { errors } = form.formState
  const text = (
    name: keyof ApplicationFormValues & string,
    label: string,
    props: React.ComponentProps<typeof Input> = {},
    className?: string,
  ) => {
    const id = `f-${name}`
    const error = errors[name]?.message
    return (
      <FormField label={label} htmlFor={id} error={error} className={className}>
        <Input id={id} {...errorProps(id, error)} {...props} {...form.register(name)} />
      </FormField>
    )
  }
  const select = <K extends string>(
    name: 'work_mode' | 'employment_type' | 'source',
    label: string,
    labels: Record<K, string>,
  ) => (
    <FormField label={label} htmlFor={`f-${name}`}>
      <Controller
        control={form.control}
        name={name}
        render={({ field }) => (
          <EnumSelect
            id={`f-${name}`}
            labels={labels}
            value={field.value as K | ''}
            onChange={field.onChange}
          />
        )}
      />
    </FormField>
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>Details</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        {text('company', 'Company')}
        {text('job_title', 'Job title')}
        {text(
          'job_url',
          'Job posting URL',
          { type: 'url', placeholder: 'https://' },
          'sm:col-span-2',
        )}
        {text('date_applied', 'Date applied', { type: 'date' })}
        {text('location', 'Location')}
        {select('work_mode', 'Work mode', WORK_MODE_LABELS)}
        {select('employment_type', 'Employment type', EMPLOYMENT_TYPE_LABELS)}
        {select('source', 'Source', SOURCE_LABELS)}
        <div className="grid grid-cols-[1fr_1fr_5rem] gap-2">
          {text('salary_min', 'Salary min', { inputMode: 'numeric' })}
          {text('salary_max', 'Salary max', { inputMode: 'numeric' })}
          {text('salary_currency', 'Currency', { maxLength: 3, className: 'uppercase' })}
        </div>
        {text('contact_name', 'Contact name')}
        {text('contact_email', 'Contact email', { type: 'email' })}
        <div className="flex items-center justify-between gap-4 rounded-lg border p-3 sm:col-span-2">
          <div>
            <label htmlFor="f-auto_close_exempt" className="text-sm font-medium">
              Never auto-close
            </label>
            <p className="text-xs text-muted-foreground">
              Keep this application open even if it goes quiet.
            </p>
          </div>
          <Controller
            control={form.control}
            name="auto_close_exempt"
            render={({ field }) => (
              <Switch
                id="f-auto_close_exempt"
                checked={field.value}
                onCheckedChange={field.onChange}
              />
            )}
          />
        </div>
      </CardContent>
    </Card>
  )
}

function NotesCard({ form }: { form: UseFormReturn<ApplicationFormValues> }) {
  const notes = useWatch({ control: form.control, name: 'notes' })
  const [mode, setMode] = useState<'write' | 'preview'>(notes ? 'preview' : 'write')

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Notes</CardTitle>
        <ToggleGroup
          type="single"
          size="sm"
          variant="outline"
          value={mode}
          onValueChange={(v) => v && setMode(v as 'write' | 'preview')}
          aria-label="Notes view"
        >
          <ToggleGroupItem value="write">
            <Pencil data-icon="inline-start" />
            Write
          </ToggleGroupItem>
          <ToggleGroupItem value="preview">Preview</ToggleGroupItem>
        </ToggleGroup>
      </CardHeader>
      <CardContent>
        {mode === 'write' ? (
          <Textarea
            aria-label="Notes"
            placeholder="Markdown supported: **bold**, lists, links…"
            className="min-h-32"
            {...form.register('notes')}
          />
        ) : notes.trim() ? (
          <div className="prose-notes">
            {/* react-markdown renders no raw HTML and drops unsafe link protocols. */}
            <Markdown
              components={{
                a: ({ node: _node, ...props }) => (
                  <a {...props} target="_blank" rel="noopener noreferrer" />
                ),
              }}
            >
              {notes}
            </Markdown>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No notes yet.</p>
        )}
      </CardContent>
    </Card>
  )
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right tabular-nums">{value}</span>
    </div>
  )
}

function DetailSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-5 w-48" />
      <div className="grid gap-6 lg:grid-cols-3">
        <Skeleton className="h-96 lg:col-span-2" />
        <Skeleton className="h-64" />
      </div>
    </div>
  )
}

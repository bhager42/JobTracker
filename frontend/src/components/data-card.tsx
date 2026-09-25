import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'

import {
  EXPORT_URL,
  useCsvImport,
  useCsvPreview,
  useImportBackup,
  useStats,
  type CsvImportResult,
  type CsvPreview,
  type ImportResult,
} from '@/api/data'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { formatBytes } from '@/lib/documents'

/** Settings → Data: stats, backup download, restore, and CSV import (PLAN.md §7.6). */
export function DataCard() {
  const stats = useStats()
  const restore = useImportBackup()
  const restoreInput = useRef<HTMLInputElement>(null)
  const [restored, setRestored] = useState<ImportResult | null>(null)
  const [csvOpen, setCsvOpen] = useState(false)

  const onRestore = async (file: File) => {
    try {
      setRestored(await restore.mutateAsync(file))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Import failed')
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Data</CardTitle>
        <CardDescription>
          Back up everything, restore a backup, or bring in a spreadsheet.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        {stats.isPending ? (
          <Skeleton className="h-16 w-full" />
        ) : stats.data ? (
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
            <Stat label="Applications" value={stats.data.applications} />
            <Stat label="Archived" value={stats.data.archived} />
            <Stat label="Status changes" value={stats.data.history_entries} />
            <Stat label="Documents" value={stats.data.documents} />
            <Stat label="Database" value={formatBytes(stats.data.database_bytes)} />
            <Stat label="Files" value={formatBytes(stats.data.uploads_bytes)} />
          </dl>
        ) : null}

        <div className="flex flex-wrap gap-2 border-t pt-4">
          <Button variant="outline" asChild>
            <a href={EXPORT_URL} download>
              <Download data-icon="inline-start" />
              Download backup (.zip)
            </a>
          </Button>
          <Button
            variant="outline"
            onClick={() => restoreInput.current?.click()}
            disabled={restore.isPending}
          >
            <Upload data-icon="inline-start" />
            {restore.isPending ? 'Importing…' : 'Restore from backup'}
          </Button>
          <input
            ref={restoreInput}
            type="file"
            hidden
            accept=".zip,.json,application/zip,application/json"
            aria-label="Backup file"
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) void onRestore(file)
            }}
          />
          <Button variant="outline" onClick={() => setCsvOpen(true)}>
            <FileSpreadsheet data-icon="inline-start" />
            Import from CSV
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          The backup holds every application, its history, your documents, and settings. Restoring
          into an empty JobTracker brings everything back exactly; into one with data, it adds
          alongside what's there.
        </p>
        {restored && <RestoreSummary result={restored} />}
      </CardContent>
      <CsvImportDialog open={csvOpen} onOpenChange={setCsvOpen} />
    </Card>
  )
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-mono tabular-nums">{value}</dd>
    </div>
  )
}

function RestoreSummary({ result }: { result: ImportResult }) {
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
  return (
    <div role="status" className="flex gap-2 rounded-lg border bg-muted/40 p-3 text-sm">
      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden />
      <div>
        <p className="font-medium">
          {result.restored ? 'Backup restored' : 'Backup imported'}:{' '}
          {plural(result.applications, 'application')}, {plural(result.documents, 'document')}.
        </p>
        {result.documents_reused > 0 && (
          <p className="text-muted-foreground">
            {plural(result.documents_reused, 'document')} matched files already here.
          </p>
        )}
        {result.documents_missing > 0 && (
          <p className="text-muted-foreground">
            {plural(result.documents_missing, 'document')} had no file in the backup and were
            skipped.
          </p>
        )}
      </div>
    </div>
  )
}

// --- CSV import -----------------------------------------------------------------------------

const FIELD_LABELS: Record<string, string> = {
  company: 'Company',
  job_title: 'Job title',
  job_url: 'Job posting URL',
  date_applied: 'Date applied',
  status: 'Status',
  source: 'Source',
  location: 'Location',
  work_mode: 'Work mode',
  employment_type: 'Employment type',
  salary_min: 'Salary (min)',
  salary_max: 'Salary (max)',
  salary_currency: 'Currency',
  contact_name: 'Contact name',
  contact_email: 'Contact email',
  notes: 'Notes',
  job_description: 'Job description',
}
const SKIP = '__skip__'

function CsvImportDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import from CSV</DialogTitle>
          <DialogDescription>
            Choose a spreadsheet saved as CSV, match its columns to fields, check it, then import.
          </DialogDescription>
        </DialogHeader>
        {open && <CsvImportFlow onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  )
}

function CsvImportFlow({ onDone }: { onDone: () => void }) {
  const preview = useCsvPreview()
  const run = useCsvImport()
  const input = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [table, setTable] = useState<CsvPreview | null>(null)
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [check, setCheck] = useState<CsvImportResult | null>(null)

  const choose = async (f: File) => {
    try {
      const p = await preview.mutateAsync(f)
      setFile(f)
      setTable(p)
      setMapping(p.suggested_mapping)
      setCheck(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not read that file')
    }
  }
  const missing = table ? table.required.filter((f) => !mapping[f]) : []

  const submit = async (dryRun: boolean) => {
    if (!file) return
    try {
      const result = await run.mutateAsync({ file, mapping, dryRun })
      if (dryRun) {
        setCheck(result)
      } else {
        toast.success(
          `Imported ${result.created} application${result.created === 1 ? '' : 's'}` +
            (result.errors.length ? `; skipped ${result.errors.length} with problems` : ''),
        )
        onDone()
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Import failed')
    }
  }

  return (
    <div className="grid min-h-0 gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="outline"
          onClick={() => input.current?.click()}
          disabled={preview.isPending}
        >
          <Upload data-icon="inline-start" />
          {file ? 'Choose another file' : 'Choose CSV file'}
        </Button>
        {file && table && (
          <span className="text-sm text-muted-foreground">
            {file.name} · {table.row_count} rows
          </span>
        )}
        <input
          ref={input}
          type="file"
          hidden
          accept=".csv,text/csv"
          aria-label="CSV file"
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) void choose(f)
          }}
        />
      </div>

      {table && (
        <div className="min-h-0 overflow-auto rounded-lg border">
          <table className="w-full text-sm">
            <caption className="sr-only">Match columns to fields</caption>
            <thead className="sticky top-0 bg-muted text-left text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  Field
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  CSV column
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  First value
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {table.fields.map((field) => {
                const column = mapping[field]
                const index = column ? table.headers.indexOf(column) : -1
                const sample = index >= 0 ? table.sample_rows[0]?.[index] : undefined
                const required = table.required.includes(field)
                return (
                  <tr key={field}>
                    <th scope="row" className="px-3 py-1.5 text-left font-normal whitespace-nowrap">
                      {FIELD_LABELS[field] ?? field}
                      {required && (
                        <span className="text-destructive" aria-label="required">
                          {' '}
                          *
                        </span>
                      )}
                    </th>
                    <td className="px-3 py-1.5">
                      <Select
                        value={column ?? SKIP}
                        onValueChange={(v) => {
                          setCheck(null)
                          setMapping((prev) => {
                            const next = { ...prev }
                            if (v === SKIP) delete next[field]
                            else next[field] = v
                            return next
                          })
                        }}
                      >
                        <SelectTrigger
                          size="sm"
                          className="w-48"
                          aria-label={`Column for ${FIELD_LABELS[field] ?? field}`}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={SKIP} className="text-muted-foreground">
                            Don't import
                          </SelectItem>
                          {table.headers
                            .filter((h) => h)
                            .map((h) => (
                              <SelectItem key={h} value={h}>
                                {h}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="max-w-48 truncate px-3 py-1.5 text-muted-foreground">
                      {sample || '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {check && <CheckSummary result={check} />}

      {table && (
        <DialogFooter className="items-center">
          {missing.length > 0 && (
            <p className="mr-auto text-xs text-destructive" role="alert">
              Choose a column for {missing.map((f) => FIELD_LABELS[f]).join(' and ')}.
            </p>
          )}
          <Button
            variant="outline"
            onClick={() => void submit(true)}
            disabled={missing.length > 0 || run.isPending}
          >
            Check
          </Button>
          <Button
            onClick={() => void submit(false)}
            disabled={!check || check.valid === 0 || run.isPending}
          >
            {check ? `Import ${check.valid} row${check.valid === 1 ? '' : 's'}` : 'Import'}
          </Button>
        </DialogFooter>
      )}
    </div>
  )
}

function CheckSummary({ result }: { result: CsvImportResult }) {
  return (
    <div role="status" className="grid gap-2 rounded-lg border bg-muted/40 p-3 text-sm">
      <p className="flex items-center gap-2 font-medium">
        <CheckCircle2 className="size-4 text-emerald-600" aria-hidden />
        {result.valid} of {result.total} rows are ready to import.
      </p>
      {result.errors.length > 0 && (
        <>
          <p className="flex items-center gap-2">
            <AlertTriangle className="size-4 text-amber-600" aria-hidden />
            {result.errors.length} will be skipped:
          </p>
          <ul className="max-h-32 overflow-auto pl-6 text-xs text-muted-foreground">
            {result.errors.map((e) => (
              <li key={e.row}>
                Line {e.row}: {e.message}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

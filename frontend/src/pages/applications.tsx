import { useNavigate, useSearch } from '@tanstack/react-router'
import type { RowSelectionState, Updater } from '@tanstack/react-table'
import { Archive, ArchiveRestore, CalendarRange, ListChecks, Search, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import {
  useApplications,
  useBulkAction,
  type Application,
  type BulkAction,
} from '@/api/applications'
import { ApplicationsTable, ColumnToggle } from '@/components/applications-table'
import { useApplicationsTable } from '@/components/applications-table-model'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { EmptyState } from '@/components/empty-state'
import { MultiSelectFilter } from '@/components/multi-select-filter'
import { PageHeader } from '@/components/page-header'
import { QuickAddDialog } from '@/components/quick-add-dialog'
import { StatusChangeDialog } from '@/components/status-change-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import {
  DEFAULT_SORT,
  PAGE_SIZES,
  hasActiveFilters,
  toListQuery,
  type ApplicationsSearch,
} from '@/lib/applications-search'
import { formatDate } from '@/lib/dates'
import { SOURCE_LABELS, WORK_MODE_LABELS } from '@/lib/enums'
import { STATUS_LABELS } from '@/lib/status'

const ARCHIVED_LABELS = {
  exclude: 'Hide archived',
  include: 'Include archived',
  only: 'Archived only',
} as const

export function ApplicationsPage() {
  const search = useSearch({ from: '/applications' })
  const navigate = useNavigate({ from: '/applications' })
  const query = toListQuery(search)
  const { data, isPending, isError, error, isPlaceholderData } = useApplications(query)

  /** Updates filters; any change other than paging goes back to page 1. */
  const setSearch = (patch: Partial<ApplicationsSearch>, keepPage = false) =>
    navigate({
      search: (prev: ApplicationsSearch) => ({
        ...prev,
        ...patch,
        ...(keepPage ? {} : { page: undefined }),
      }),
      replace: true,
    })

  // Selection belongs to one result set; it resets whenever the query changes.
  const queryKey = JSON.stringify(query)
  const [selection, setSelection] = useState<{ key: string; rows: RowSelectionState }>({
    key: queryKey,
    rows: {},
  })
  const rowSelection = selection.key === queryKey ? selection.rows : {}
  const onRowSelectionChange = (updater: Updater<RowSelectionState>) =>
    setSelection({
      key: queryKey,
      rows: typeof updater === 'function' ? updater(rowSelection) : updater,
    })
  const clearSelection = () => setSelection({ key: queryKey, rows: {} })

  // Past the last page (e.g. after deleting its rows): jump back to the last real page.
  const overshot = data && data.items.length === 0 && data.total > 0 && data.page > 1
  useEffect(() => {
    if (overshot) setSearch({ page: Math.ceil(data.total / data.page_size) }, true)
  })

  const items = data?.items ?? []
  const table = useApplicationsTable({ data: items, rowSelection, onRowSelectionChange })
  const selected = items.filter((a) => rowSelection[String(a.id)])

  return (
    <>
      <PageHeader
        title="Applications"
        description="Every job you've applied to, in one place."
        actions={<QuickAddDialog />}
      />

      <div className="flex flex-wrap items-center gap-2">
        <SearchBox value={search.q ?? ''} onChange={(q) => setSearch({ q: q || undefined })} />
        <MultiSelectFilter
          title="Status"
          labels={STATUS_LABELS}
          selected={search.status ?? []}
          onChange={(status) => setSearch({ status })}
        />
        <MultiSelectFilter
          title="Source"
          labels={SOURCE_LABELS}
          selected={search.source ?? []}
          onChange={(source) => setSearch({ source })}
        />
        <MultiSelectFilter
          title="Work mode"
          labels={WORK_MODE_LABELS}
          selected={search.work_mode ?? []}
          onChange={(work_mode) => setSearch({ work_mode })}
        />
        <DateRangeFilter
          from={search.from}
          to={search.to}
          onChange={(from, to) => setSearch({ from, to })}
        />
        <Select
          value={search.archived ?? 'exclude'}
          onValueChange={(v) =>
            setSearch({ archived: v === 'exclude' ? undefined : (v as 'include' | 'only') })
          }
        >
          <SelectTrigger aria-label="Archived applications" className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(ARCHIVED_LABELS).map(([key, label]) => (
              <SelectItem key={key} value={key}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {hasActiveFilters(search) && (
          <Button
            variant="ghost"
            onClick={() =>
              navigate({
                search: { sort: search.sort, page_size: search.page_size },
                replace: true,
              })
            }
          >
            Reset
            <X data-icon="inline-end" />
          </Button>
        )}
        <div className="ml-auto">
          <ColumnToggle table={table} />
        </div>
      </div>

      {selected.length > 0 && <BulkBar selected={selected} onDone={clearSelection} />}

      {isPending ? (
        <TableSkeleton />
      ) : isError ? (
        <EmptyState
          icon={ListChecks}
          title="Could not load applications"
          description={error.message}
        />
      ) : data.total === 0 ? (
        hasActiveFilters(search) ? (
          <EmptyState
            icon={Search}
            title="No matches"
            description="No applications match these filters. Try widening or resetting them."
          />
        ) : (
          <EmptyState
            icon={ListChecks}
            title="No applications yet"
            description="Add your first application to start tracking it."
            action={<QuickAddDialog />}
          />
        )
      ) : (
        <>
          <ApplicationsTable
            table={table}
            sort={query.sort ?? DEFAULT_SORT}
            onSortChange={(sort) => setSearch({ sort: sort === DEFAULT_SORT ? undefined : sort })}
            dimmed={isPlaceholderData}
          />
          <Pagination
            page={data.page}
            pageSize={data.page_size}
            total={data.total}
            onPage={(page) => setSearch({ page: page === 1 ? undefined : page }, true)}
            onPageSize={(size) => setSearch({ page_size: size === 50 ? undefined : size })}
          />
        </>
      )}
    </>
  )
}

/** Search input that updates the URL after typing pauses. */
function SearchBox({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [text, setText] = useState(value)
  const [synced, setSynced] = useState(value)
  if (value !== synced) {
    // The URL changed elsewhere (e.g. Reset): follow it.
    setSynced(value)
    setText(value)
  }

  useEffect(() => {
    if (text.trim() === value.trim()) return
    const timer = setTimeout(() => onChange(text.trim()), 250)
    return () => clearTimeout(timer)
  }, [text, value, onChange])

  return (
    <div className="relative w-full sm:w-64">
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        aria-label="Search company, title, or notes"
        placeholder="Search company, title, notes…"
        className="pl-8"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
    </div>
  )
}

function DateRangeFilter({
  from,
  to,
  onChange,
}: {
  from?: string
  to?: string
  onChange: (from?: string, to?: string) => void
}) {
  const active = Boolean(from || to)
  const summary =
    from && to
      ? `${formatDate(from)} – ${formatDate(to)}`
      : from
        ? `From ${formatDate(from)}`
        : to
          ? `Until ${formatDate(to)}`
          : 'Date applied'

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className={active ? undefined : 'border-dashed'}>
          <CalendarRange data-icon="inline-start" />
          {summary}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="grid w-64 gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="filter-from">Applied on or after</Label>
          <Input
            id="filter-from"
            type="date"
            value={from ?? ''}
            max={to}
            onChange={(e) => onChange(e.target.value || undefined, to)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="filter-to">Applied on or before</Label>
          <Input
            id="filter-to"
            type="date"
            value={to ?? ''}
            min={from}
            onChange={(e) => onChange(from, e.target.value || undefined)}
          />
        </div>
        {active && (
          <Button variant="ghost" size="sm" onClick={() => onChange(undefined, undefined)}>
            Clear dates
          </Button>
        )}
      </PopoverContent>
    </Popover>
  )
}

function BulkBar({ selected, onDone }: { selected: Application[]; onDone: () => void }) {
  const bulk = useBulkAction()
  const [statusOpen, setStatusOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const ids = selected.map((a) => a.id)
  const count = selected.length
  const noun = count === 1 ? 'application' : 'applications'

  const run = async (body: Omit<BulkAction, 'ids'>, done: string) => {
    try {
      const { affected } = await bulk.mutateAsync({ ...body, ids })
      toast.success(`${done} ${affected} ${affected === 1 ? 'application' : 'applications'}`)
      onDone()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Bulk action failed')
    }
  }

  return (
    <div
      role="region"
      aria-label="Bulk actions"
      className="flex flex-wrap items-center gap-2 rounded-xl border bg-muted/50 px-3 py-2 text-sm"
    >
      <span className="font-medium tabular-nums">
        {count} {noun} selected
      </span>
      <div className="flex flex-wrap gap-1.5 sm:ml-auto">
        <Button variant="outline" size="sm" onClick={() => setStatusOpen(true)}>
          Change status
        </Button>
        {selected.some((a) => !a.archived) && (
          <Button
            variant="outline"
            size="sm"
            disabled={bulk.isPending}
            onClick={() => run({ action: 'archive' }, 'Archived')}
          >
            <Archive data-icon="inline-start" />
            Archive
          </Button>
        )}
        {selected.some((a) => a.archived) && (
          <Button
            variant="outline"
            size="sm"
            disabled={bulk.isPending}
            onClick={() => run({ action: 'unarchive' }, 'Unarchived')}
          >
            <ArchiveRestore data-icon="inline-start" />
            Unarchive
          </Button>
        )}
        <Button variant="destructive" size="sm" onClick={() => setDeleteOpen(true)}>
          <Trash2 data-icon="inline-start" />
          Delete
        </Button>
        <Button variant="ghost" size="sm" onClick={onDone}>
          Clear
        </Button>
      </div>

      <StatusChangeDialog
        open={statusOpen}
        onOpenChange={setStatusOpen}
        initialStatus={selected[0]!.status}
        title={`Change status of ${count} ${noun}`}
        description="Each application gets its own history entry."
        pending={bulk.isPending}
        onSubmit={async (payload) => {
          await run({ action: 'set_status', payload }, 'Updated')
          setStatusOpen(false)
        }}
      />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Delete ${count} ${noun}?`}
        description="This permanently removes them and their status history. Archive instead if you might want them later."
        confirmLabel="Delete"
        onConfirm={() => run({ action: 'delete' }, 'Deleted')}
      />
    </div>
  )
}

function Pagination({
  page,
  pageSize,
  total,
  onPage,
  onPageSize,
}: {
  page: number
  pageSize: number
  total: number
  onPage: (page: number) => void
  onPageSize: (size: number) => void
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1
  const last = Math.min(page * pageSize, total)

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
      <p className="tabular-nums" aria-live="polite">
        {first}–{last} of {total}
      </p>
      <div className="flex items-center gap-2">
        <Label htmlFor="page-size" className="font-normal whitespace-nowrap">
          Rows per page
        </Label>
        <Select value={String(pageSize)} onValueChange={(v) => onPageSize(Number(v))}>
          <SelectTrigger id="page-size" size="sm" className="w-20">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PAGE_SIZES.map((size) => (
              <SelectItem key={size} value={String(size)}>
                {size}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </Button>
        <span className="whitespace-nowrap tabular-nums">
          {page} / {pages}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  )
}

function TableSkeleton() {
  return (
    <div className="space-y-2 rounded-xl border p-4" aria-busy="true" aria-label="Loading">
      {Array.from({ length: 6 }, (_, i) => (
        <Skeleton key={i} className="h-8 w-full" />
      ))}
    </div>
  )
}

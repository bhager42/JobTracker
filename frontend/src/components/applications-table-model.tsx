import { Link } from '@tanstack/react-router'
import {
  columnVisibilityFeature,
  metaHelper,
  rowSelectionFeature,
  tableFeatures,
  useTable,
  type ColumnDef,
  type ColumnVisibilityState,
  type OnChangeFn,
  type ReactTable,
  type RowSelectionState,
} from '@tanstack/react-table'
import { useState } from 'react'

import type { Application } from '@/api/applications'
import { StatusBadge } from '@/components/status-badge'
import { Checkbox } from '@/components/ui/checkbox'
import type { SortField } from '@/lib/applications-search'
import { formatDate, formatRelative } from '@/lib/dates'
import { SOURCE_LABELS, WORK_MODE_LABELS } from '@/lib/enums'
import { formatSalary } from '@/lib/format'

/** Column definitions and table state for the Applications table. */

export interface ColumnMeta {
  label: string
  sortField?: SortField
  className?: string
}

// Sorting and paging happen on the server, so only selection and visibility run here.
const features = tableFeatures({
  rowSelectionFeature,
  columnVisibilityFeature,
  columnMeta: metaHelper<ColumnMeta>(),
})
type Features = typeof features
export type AppTable = ReactTable<Features, Application>

const muted = (text: string) => (text ? text : <span className="text-muted-foreground/60">—</span>)

const COLUMNS: ColumnDef<Features, Application>[] = [
  {
    id: 'select',
    enableHiding: false,
    header: ({ table }) => (
      <Checkbox
        aria-label="Select all on this page"
        checked={
          table.getIsAllPageRowsSelected() ||
          (table.getIsSomePageRowsSelected() ? 'indeterminate' : false)
        }
        onCheckedChange={(v) => table.toggleAllPageRowsSelected(v === true)}
      />
    ),
    cell: ({ row }) => (
      <Checkbox
        aria-label={`Select ${row.original.company}`}
        checked={row.getIsSelected()}
        onCheckedChange={(v) => row.toggleSelected(v === true)}
        onClick={(e) => e.stopPropagation()}
      />
    ),
    meta: { label: 'Select', className: 'w-10' },
  },
  {
    id: 'company',
    enableHiding: false,
    cell: ({ row }) => (
      <Link
        to="/applications/$id"
        params={{ id: String(row.original.id) }}
        className="font-medium hover:underline focus-visible:underline"
        onClick={(e) => e.stopPropagation()}
      >
        {row.original.company}
      </Link>
    ),
    meta: { label: 'Company', sortField: 'company' },
  },
  {
    id: 'job_title',
    cell: ({ row }) => row.original.job_title,
    meta: { label: 'Job title', sortField: 'job_title', className: 'max-w-72 truncate' },
  },
  {
    id: 'status',
    cell: ({ row }) => (
      <StatusBadge status={row.original.status} interviewRounds={row.original.interview_rounds} />
    ),
    meta: { label: 'Status', sortField: 'status' },
  },
  {
    id: 'date_applied',
    cell: ({ row }) => formatDate(row.original.date_applied),
    meta: { label: 'Applied', sortField: 'date_applied', className: 'tabular-nums' },
  },
  {
    id: 'source',
    cell: ({ row }) => muted(row.original.source ? SOURCE_LABELS[row.original.source] : ''),
    meta: { label: 'Source' },
  },
  {
    id: 'work_mode',
    cell: ({ row }) =>
      muted(row.original.work_mode ? WORK_MODE_LABELS[row.original.work_mode] : ''),
    meta: { label: 'Work mode' },
  },
  {
    id: 'location',
    cell: ({ row }) => muted(row.original.location ?? ''),
    meta: { label: 'Location', className: 'max-w-48 truncate' },
  },
  {
    id: 'salary',
    cell: ({ row }) =>
      muted(
        formatSalary(
          row.original.salary_min,
          row.original.salary_max,
          row.original.salary_currency,
        ),
      ),
    meta: { label: 'Salary', className: 'tabular-nums' },
  },
  {
    id: 'status_changed_at',
    cell: ({ row }) => formatRelative(row.original.status_changed_at),
    meta: { label: 'Status changed', sortField: 'status_changed_at' },
  },
  {
    id: 'updated_at',
    cell: ({ row }) => formatRelative(row.original.updated_at),
    meta: { label: 'Updated', sortField: 'updated_at' },
  },
]

export const metaOf = (column: { columnDef: ColumnDef<Features, Application> }) =>
  column.columnDef.meta as ColumnMeta

const VISIBILITY_KEY = 'jobtracker-applications-columns'
const DEFAULT_VISIBILITY: ColumnVisibilityState = {
  location: false,
  salary: false,
  status_changed_at: false,
  updated_at: false,
}

function loadVisibility(): ColumnVisibilityState {
  try {
    const raw = localStorage.getItem(VISIBILITY_KEY)
    if (raw) return { ...DEFAULT_VISIBILITY, ...(JSON.parse(raw) as ColumnVisibilityState) }
  } catch {
    // storage unavailable or corrupt: use defaults
  }
  return DEFAULT_VISIBILITY
}

export function useApplicationsTable({
  data,
  rowSelection,
  onRowSelectionChange,
}: {
  data: Application[]
  rowSelection: RowSelectionState
  onRowSelectionChange: OnChangeFn<RowSelectionState>
}) {
  const [columnVisibility, setColumnVisibility] = useState(loadVisibility)
  const onColumnVisibilityChange: OnChangeFn<ColumnVisibilityState> = (updater) => {
    setColumnVisibility((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      try {
        localStorage.setItem(VISIBILITY_KEY, JSON.stringify(next))
      } catch {
        // ignore; the choice still applies for this session
      }
      return next
    })
  }

  return useTable({
    features,
    data,
    columns: COLUMNS,
    getRowId: (row) => String(row.id),
    state: { rowSelection, columnVisibility },
    onRowSelectionChange,
    onColumnVisibilityChange,
  })
}

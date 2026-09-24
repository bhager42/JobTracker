import { useNavigate } from '@tanstack/react-router'
import { ArrowDown, ArrowUp, ArrowUpDown, Columns3 } from 'lucide-react'

import type { SortKey } from '@/api/applications'
import { metaOf, type AppTable } from '@/components/applications-table-model'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { nextSort } from '@/lib/applications-search'
import { cn } from '@/lib/utils'

export function ColumnToggle({ table }: { table: AppTable }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">
          <Columns3 data-icon="inline-start" />
          Columns
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuLabel>Visible columns</DropdownMenuLabel>
        {table
          .getAllLeafColumns()
          .filter((column) => column.getCanHide())
          .map((column) => (
            <DropdownMenuCheckboxItem
              key={column.id}
              checked={column.getIsVisible()}
              onCheckedChange={(v) => column.toggleVisibility(v === true)}
              onSelect={(e) => e.preventDefault()}
            >
              {metaOf(column).label}
            </DropdownMenuCheckboxItem>
          ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function ApplicationsTable({
  table,
  sort,
  onSortChange,
  dimmed,
}: {
  table: AppTable
  sort: SortKey
  onSortChange: (sort: SortKey) => void
  dimmed?: boolean
}) {
  const navigate = useNavigate()

  return (
    <div
      className={cn(
        'overflow-hidden rounded-xl border bg-card transition-opacity',
        dimmed && 'opacity-60',
      )}
    >
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id} className="hover:bg-transparent">
              {group.headers.map((header) => {
                const meta = metaOf(header.column)
                const field = meta.sortField
                const direction =
                  field && sort === field ? 'asc' : field && sort === `-${field}` ? 'desc' : null
                return (
                  <TableHead
                    key={header.id}
                    className={meta.className}
                    aria-sort={
                      direction === 'asc'
                        ? 'ascending'
                        : direction === 'desc'
                          ? 'descending'
                          : undefined
                    }
                  >
                    {header.column.id === 'select' ? (
                      <table.FlexRender header={header} />
                    ) : field ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="-ml-2.5 text-muted-foreground"
                        aria-label={`Sort by ${meta.label}`}
                        onClick={() => onSortChange(nextSort(sort, field))}
                      >
                        {meta.label}
                        {direction === 'asc' ? (
                          <ArrowUp data-icon="inline-end" />
                        ) : direction === 'desc' ? (
                          <ArrowDown data-icon="inline-end" />
                        ) : (
                          <ArrowUpDown data-icon="inline-end" className="opacity-40" />
                        )}
                      </Button>
                    ) : (
                      <span className="text-muted-foreground">{meta.label}</span>
                    )}
                  </TableHead>
                )
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.map((row) => (
            <TableRow
              key={row.id}
              data-state={row.getIsSelected() ? 'selected' : undefined}
              className="cursor-pointer"
              onClick={() =>
                navigate({ to: '/applications/$id', params: { id: String(row.original.id) } })
              }
            >
              {row.getVisibleCells().map((cell) => (
                <TableCell
                  key={cell.id}
                  className={metaOf(cell.column).className}
                  // Clicks around the checkbox select the row rather than opening it.
                  onClick={cell.column.id === 'select' ? (e) => e.stopPropagation() : undefined}
                >
                  <table.FlexRender cell={cell} />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

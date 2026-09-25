import { useNavigate } from '@tanstack/react-router'
import {
  BarChart3,
  FileText,
  LayoutDashboard,
  ListChecks,
  Loader2,
  Plus,
  Settings,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useState } from 'react'

import { useApplications } from '@/api/applications'
import { StatusBadge } from '@/components/status-badge'
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from '@/components/ui/command'
import type { GoTarget } from '@/hooks/use-keyboard-shortcuts'

const PAGES: { to: GoTarget; label: string; icon: LucideIcon; keys: string }[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, keys: 'G D' },
  { to: '/applications', label: 'Applications', icon: ListChecks, keys: 'G A' },
  { to: '/documents', label: 'Documents', icon: FileText, keys: 'G O' },
  { to: '/metrics', label: 'Metrics', icon: BarChart3, keys: 'G M' },
  { to: '/settings', label: 'Settings', icon: Settings, keys: 'G S' },
]

/** ⌘K: find an application by company or title, create one, or switch pages. */
export function CommandPalette({
  open,
  onOpenChange,
  onNewApplication,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onNewApplication: () => void
}) {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [debounced, setDebounced] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(q.trim()), 150)
    return () => clearTimeout(timer)
  }, [q])

  const results = useApplications(
    { q: debounced, archived: 'include', sort: '-updated_at', page: 1, page_size: 8 },
    { enabled: open && debounced !== '' },
  )
  const needle = q.trim().toLowerCase()
  const pages = PAGES.filter((p) => p.label.toLowerCase().includes(needle))
  const showNew = !needle || 'new application'.includes(needle) || 'create'.includes(needle)
  const apps = debounced ? (results.data?.items ?? []) : []

  const close = (next: boolean) => {
    if (!next) setQ('')
    onOpenChange(next)
  }
  const run = (action: () => void) => {
    close(false)
    action()
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={close}
      title="Search"
      description="Search applications, create one, or go to a page."
    >
      {/* Results come from the API, so cmdk's own fuzzy filter is off. */}
      <Command shouldFilter={false}>
        <CommandInput
          value={q}
          onValueChange={setQ}
          placeholder="Search applications or jump to a page…"
        />
        <CommandList>
          <CommandEmpty>
            {results.isFetching ? 'Searching…' : `No results for “${q.trim()}”.`}
          </CommandEmpty>
          {apps.length > 0 && (
            <CommandGroup heading="Applications">
              {apps.map((app) => (
                <CommandItem
                  key={app.id}
                  value={`app-${app.id}`}
                  onSelect={() =>
                    run(() => navigate({ to: '/applications/$id', params: { id: String(app.id) } }))
                  }
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{app.company}</p>
                    <p className="truncate text-xs text-muted-foreground">{app.job_title}</p>
                  </div>
                  <StatusBadge status={app.status} interviewRounds={app.interview_rounds} />
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {debounced && results.isFetching && apps.length === 0 && (
            <div className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Searching applications…
            </div>
          )}
          {showNew && (
            <CommandGroup heading="Actions">
              <CommandItem value="new-application" onSelect={() => run(onNewApplication)}>
                <Plus />
                New application
                <CommandShortcut>N</CommandShortcut>
              </CommandItem>
            </CommandGroup>
          )}
          {pages.length > 0 && (
            <CommandGroup heading="Go to">
              {pages.map(({ to, label, icon: Icon, keys }) => (
                <CommandItem
                  key={to}
                  value={`page-${to}`}
                  onSelect={() => run(() => navigate({ to }))}
                >
                  <Icon />
                  {label}
                  <CommandShortcut>{keys}</CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  )
}

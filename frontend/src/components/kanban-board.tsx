import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MeasuringStrategy,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { Link } from '@tanstack/react-router'
import { ChevronDown, ChevronRight, GripVertical, MoreHorizontal } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'

import {
  useMoveApplication,
  type Application,
  type BoardQuery,
  type StatusChange,
} from '@/api/applications'
import { AutoCloseHint, AutoClosedIcon } from '@/components/auto-close-hint'
import { StatusBadge } from '@/components/status-badge'
import { StatusChangeDialog } from '@/components/status-change-dialog'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { formatDate } from '@/lib/dates'
import { STATUSES, STATUS_META, TONE_DOT, statusLabel, type Status } from '@/lib/status'
import { cn } from '@/lib/utils'

// Wishlist first, then the active pipeline; closed statuses share one collapsible group.
const OPEN_COLUMNS: Status[] = ['saved', 'applied', 'screening', 'interviewing', 'offer']
const CLOSED_STATUSES: Status[] = STATUSES.filter((s) => STATUS_META[s].group === 'closed')

/** Moving to this status asks how many rounds were reached (PLAN.md §7.3). */
const ASKS_ROUNDS: Status = 'rejected_after_interview'

export function KanbanBoard({ apps, query }: { apps: Application[]; query: BoardQuery }) {
  const move = useMoveApplication(query)
  const [dragging, setDragging] = useState<Application | null>(null)
  const [closedOpen, setClosedOpen] = useState(false)
  const [asking, setAsking] = useState<{ app: Application; target: Status } | null>(null)

  const sensors = useSensors(
    // A small distance lets a plain click open the card instead of starting a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  )

  const byStatus = new Map<Status, Application[]>()
  for (const app of apps) {
    byStatus.set(app.status, [...(byStatus.get(app.status) ?? []), app])
  }
  const closedCount = CLOSED_STATUSES.reduce((n, s) => n + (byStatus.get(s)?.length ?? 0), 0)

  const commit = (app: Application, change: StatusChange) => {
    const from = { status: app.status, rounds: app.interview_rounds }
    move.mutate(
      { id: app.id, change },
      {
        onSuccess: () =>
          toast.success(
            `Moved ${app.company} to ${statusLabel(change.status, change.interview_rounds ?? 0)}`,
            {
              action: {
                label: 'Undo',
                onClick: () =>
                  move.mutate({
                    id: app.id,
                    change: { status: from.status, interview_rounds: from.rounds },
                  }),
              },
            },
          ),
        onError: (err) =>
          toast.error(`Couldn't move ${app.company}: ${err instanceof Error ? err.message : ''}`),
      },
    )
  }

  const requestMove = (app: Application, target: Status) => {
    if (target === app.status) return
    if (target === ASKS_ROUNDS) setAsking({ app, target })
    else commit(app, { status: target })
  }

  const onDragStart = (e: DragStartEvent) => {
    setDragging(apps.find((a) => a.id === e.active.id) ?? null)
  }
  const onDragEnd = (e: DragEndEvent) => {
    setDragging(null)
    const app = apps.find((a) => a.id === e.active.id)
    const target = e.over?.id as Status | undefined
    if (app && target) requestMove(app, target)
  }

  return (
    <>
      <DndContext
        sensors={sensors}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setDragging(null)}
        // The closed-status tray mounts mid-drag, so keep measuring drop targets.
        measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
        accessibility={{
          announcements: {
            onDragStart: ({ active }) => `Picked up ${nameOf(apps, active.id)}.`,
            onDragOver: ({ over }) =>
              over ? `Over ${STATUS_META[over.id as Status].label}.` : 'Not over a column.',
            onDragEnd: ({ active, over }) =>
              over
                ? `Moved ${nameOf(apps, active.id)} to ${STATUS_META[over.id as Status].label}.`
                : 'Dropped outside the board. Nothing changed.',
            onDragCancel: () => 'Move cancelled.',
          },
        }}
      >
        <div
          className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-4 overflow-x-auto px-4 pb-4 md:mx-0 md:scroll-px-0 md:px-0"
          role="region"
          aria-label="Application board"
        >
          {OPEN_COLUMNS.map((status) => (
            <Column key={status} status={status} count={byStatus.get(status)?.length ?? 0}>
              {(byStatus.get(status) ?? []).map((app) => (
                <DraggableCard key={app.id} app={app} onMove={requestMove} />
              ))}
            </Column>
          ))}

          <section
            className="flex w-64 shrink-0 snap-start flex-col rounded-2xl bg-muted/40 p-2"
            aria-label={`Closed, ${closedCount} applications`}
          >
            <button
              type="button"
              onClick={() => setClosedOpen((v) => !v)}
              aria-expanded={closedOpen}
              className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-medium hover:bg-muted"
            >
              {closedOpen ? (
                <ChevronDown className="size-4" />
              ) : (
                <ChevronRight className="size-4" />
              )}
              Closed
              <span className="ml-auto font-mono text-xs text-muted-foreground tabular-nums">
                {closedCount}
              </span>
            </button>
            <div className="mt-2 grid gap-2">
              {CLOSED_STATUSES.map((status) => {
                const items = byStatus.get(status) ?? []
                if (!closedOpen && items.length === 0) return null
                return (
                  <ClosedSection
                    key={status}
                    status={status}
                    count={items.length}
                    expanded={closedOpen}
                  >
                    {closedOpen &&
                      items.map((app) => (
                        <DraggableCard key={app.id} app={app} onMove={requestMove} />
                      ))}
                  </ClosedSection>
                )
              })}
            </div>
          </section>
        </div>

        {/* Closed statuses as drop targets pinned to the viewport, so they're reachable
            however far the board is scrolled. */}
        {dragging && <ClosedDropTray />}

        <DragOverlay dropAnimation={null}>
          {dragging && <CardBody app={dragging} overlay />}
        </DragOverlay>
      </DndContext>

      <StatusChangeDialog
        open={asking !== null}
        onOpenChange={(open) => !open && setAsking(null)}
        initialStatus={asking?.target ?? ASKS_ROUNDS}
        initialRounds={Math.max(asking?.app.interview_rounds ?? 1, 1)}
        title={asking ? `Move ${asking.app.company}` : 'Move application'}
        description="How many interview rounds did you reach?"
        onSubmit={(change) => {
          if (asking) commit(asking.app, change)
          setAsking(null)
        }}
      />
    </>
  )
}

function nameOf(apps: Application[], id: string | number): string {
  return apps.find((a) => a.id === id)?.company ?? 'application'
}

function Column({
  status,
  count,
  children,
}: {
  status: Status
  count: number
  children: ReactNode
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status })
  return (
    <section
      ref={setNodeRef}
      aria-label={`${STATUS_META[status].label}, ${count} applications`}
      className={cn(
        'flex w-64 shrink-0 snap-start flex-col rounded-2xl bg-muted/40 p-2 transition-colors',
        isOver && 'bg-muted ring-2 ring-ring/40',
      )}
    >
      <h3 className="flex items-center gap-2 px-2 py-1.5 text-sm font-medium">
        <span className={cn('size-2 rounded-full', TONE_DOT[STATUS_META[status].tone])} />
        {STATUS_META[status].label}
        <span className="ml-auto font-mono text-xs text-muted-foreground tabular-nums">
          {count}
        </span>
      </h3>
      <div className="mt-2 grid min-h-24 content-start gap-2">{children}</div>
    </section>
  )
}

function ClosedSection({
  status,
  count,
  expanded,
  children,
}: {
  status: Status
  count: number
  expanded: boolean
  children: ReactNode
}) {
  return (
    <div className="grid gap-2 rounded-lg px-2 py-1.5">
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className={cn('size-1.5 rounded-full', TONE_DOT[STATUS_META[status].tone])} />
        {STATUS_META[status].label}
        <span className="ml-auto font-mono tabular-nums">{count}</span>
      </p>
      {expanded && children}
    </div>
  )
}

function ClosedDropTray() {
  return (
    <div
      role="group"
      aria-label="Close as"
      className="fixed inset-x-4 bottom-4 z-50 mx-auto flex max-w-4xl flex-wrap items-center justify-center gap-2 rounded-2xl border bg-background/95 p-3 shadow-lg backdrop-blur"
    >
      <span className="text-xs font-medium text-muted-foreground">Drop to close as</span>
      {CLOSED_STATUSES.map((status) => (
        <ClosedDropTarget key={status} status={status} />
      ))}
    </div>
  )
}

function ClosedDropTarget({ status }: { status: Status }) {
  const { setNodeRef, isOver } = useDroppable({ id: status })
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex items-center gap-1.5 rounded-lg border border-dashed px-3 py-2 text-xs font-medium transition-colors',
        isOver && 'border-solid bg-muted ring-2 ring-ring/40',
      )}
    >
      <span className={cn('size-2 rounded-full', TONE_DOT[STATUS_META[status].tone])} />
      {STATUS_META[status].label}
    </div>
  )
}

function DraggableCard({
  app,
  onMove,
}: {
  app: Application
  onMove: (app: Application, target: Status) => void
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: app.id })
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      aria-roledescription="Draggable application card"
      aria-label={`${app.company}, ${app.job_title}`}
      className={cn(
        'rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
        isDragging && 'opacity-40',
      )}
    >
      <CardBody app={app} onMove={onMove} />
    </div>
  )
}

function CardBody({
  app,
  overlay,
  onMove,
}: {
  app: Application
  overlay?: boolean
  onMove?: (app: Application, target: Status) => void
}) {
  const closed = STATUS_META[app.status].group === 'closed'
  return (
    <article
      className={cn(
        'group relative grid gap-1.5 rounded-xl border bg-card p-3 text-sm shadow-xs',
        overlay ? 'cursor-grabbing shadow-lg' : 'cursor-grab',
      )}
    >
      <div className="flex items-start gap-1">
        <GripVertical className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/50" aria-hidden />
        <div className="min-w-0 flex-1">
          <Link
            to="/applications/$id"
            params={{ id: String(app.id) }}
            className="block truncate font-medium hover:underline"
            // Keep the link from being the drag handle's click target during keyboard drags.
            onKeyDown={(e) => e.stopPropagation()}
          >
            {app.company}
          </Link>
          <p className="truncate text-xs text-muted-foreground">{app.job_title}</p>
        </div>
        {onMove && <MoveMenu app={app} onMove={onMove} />}
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pl-4 text-xs text-muted-foreground">
        {closed && <StatusBadge status={app.status} interviewRounds={app.interview_rounds} />}
        {app.auto_closed && <AutoClosedIcon className="[&_svg]:size-3.5" />}
        {app.date_applied && <span className="tabular-nums">{formatDate(app.date_applied)}</span>}
        <AutoCloseHint autoCloseAt={app.auto_close_at} />
      </div>
    </article>
  )
}

/** A non-drag way to move a card: works by keyboard, screen reader, and touch. */
function MoveMenu({
  app,
  onMove,
}: {
  app: Application
  onMove: (app: Application, target: Status) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`Move ${app.company}`}
          className="-mt-0.5 -mr-1 opacity-60 group-hover:opacity-100"
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel>Move to</DropdownMenuLabel>
        {OPEN_COLUMNS.map((s) => (
          <DropdownMenuItem key={s} disabled={s === app.status} onSelect={() => onMove(app, s)}>
            <span className={cn('size-2 rounded-full', TONE_DOT[STATUS_META[s].tone])} />
            {STATUS_META[s].label}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        {CLOSED_STATUSES.map((s) => (
          <DropdownMenuItem key={s} disabled={s === app.status} onSelect={() => onMove(app, s)}>
            <span className={cn('size-2 rounded-full', TONE_DOT[STATUS_META[s].tone])} />
            {STATUS_META[s].label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// List view (spec §6 "List"): a dense, sortable, groupable, virtualized table of all tasks.
//
// TanStack Table owns the column model, header rendering and sort state (asc → desc → none);
// the actual ordering is done by `sortListTasks` (manualSorting) so empty values stay last in
// both directions and "no sort" means our default order. Rows are virtualized with
// @tanstack/react-virtual over the flattened (grouped) row list.
import {
  createColumnHelper,
  flexRender,
  rowSortingFeature,
  tableFeatures,
  useTable,
  type Row,
  type SortingState,
  type Updater,
} from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowDown, ArrowUp, ChevronRight, Rows3 } from 'lucide-react'
import { memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { STATUSES, STATUS_LABELS } from '@shared/constants'
import { formatRelativeDate, localDateOfTimestamp } from '@shared/dates'
import type { LocalDate, Status, Task } from '@shared/types'
import { ToolbarButton, ToolbarControls } from '@/app/ToolbarControls'
import {
  DueDateBadge,
  PriorityIcon,
  PrioritySelect,
  StatusIcon,
  StatusSelect,
  TaskContextMenu,
  TaskTags,
} from '@/components/task'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { modKeyLabel } from '@/lib/platform'
import { useToday } from '@/lib/useToday'
import { cn } from '@/lib/utils'
import { useFilteredTasks, useTagsById, useTasks } from '@/stores/selectors'
import { useTasksStore } from '@/stores/tasksStore'
import { useUiStore } from '@/stores/uiStore'
import {
  adjacentTaskId,
  buildListRows,
  filterByStatus,
  sortListTasks,
  type ListColumnId,
  type ListGroupBy,
  type ListGroupRow,
  type ListRow,
} from './listModel'
import { useListViewStore } from './listViewStore'

const ROW_HEIGHT = 34
const HEADER_HEIGHT = 32

const features = tableFeatures({ rowSortingFeature })
type ListTableRow = Row<typeof features, Task>

const COLUMN_WIDTHS: Record<ListColumnId, string> = {
  status: '44px',
  title: 'minmax(220px, 1fr)',
  priority: '108px',
  tags: '168px',
  startDate: '92px',
  dueDate: '100px',
  createdAt: '92px',
  completedAt: '100px',
}
const MIN_TABLE_WIDTH = 1000

// --- cells -------------------------------------------------------------------------------

/** Wraps an inline control so interacting with it never also selects the row. */
function RowControl({ children }: { children: React.ReactNode }) {
  return (
    <div
      data-row-control
      className="flex items-center"
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {children}
    </div>
  )
}

function Empty() {
  return <span className="text-muted-foreground/40">—</span>
}

function DateText({ date }: { date: LocalDate | null }) {
  const today = useToday()
  if (!date) return <Empty />
  return (
    <span className="text-xs whitespace-nowrap text-muted-foreground tabular-nums" title={date}>
      {formatRelativeDate(date, today)}
    </span>
  )
}

function TimestampText({ ms }: { ms: number | null }) {
  return <DateText date={ms === null ? null : localDateOfTimestamp(ms)} />
}

const helper = createColumnHelper<typeof features, Task>()
const update = (
  id: string,
  patch: Parameters<ReturnType<typeof useTasksStore.getState>['update']>[1],
) => void useTasksStore.getState().update(id, patch)

const columns = helper.columns([
  helper.accessor('status', {
    header: 'Status',
    cell: ({ row }) => (
      <RowControl>
        <StatusSelect
          compact
          value={row.original.status}
          onChange={(status) => update(row.original.id, { status })}
        />
      </RowControl>
    ),
  }),
  helper.accessor('title', {
    header: 'Title',
    cell: ({ row }) => (
      <span className="truncate" title={row.original.title}>
        {row.original.title}
      </span>
    ),
  }),
  helper.accessor('priority', {
    header: 'Priority',
    cell: ({ row }) => (
      <RowControl>
        <PrioritySelect
          value={row.original.priority}
          onChange={(priority) => update(row.original.id, { priority })}
          className="-ml-2 h-6 text-xs"
        />
      </RowControl>
    ),
  }),
  helper.accessor('tagIds', {
    id: 'tags',
    header: 'Tags',
    cell: ({ row }) => (
      <TaskTags tagIds={row.original.tagIds} max={2} className="flex-nowrap overflow-hidden" />
    ),
  }),
  helper.accessor('startDate', {
    header: 'Start',
    cell: ({ row }) => <DateText date={row.original.startDate} />,
  }),
  helper.accessor('dueDate', {
    header: 'Due',
    cell: ({ row }) =>
      row.original.dueDate ? (
        <DueDateBadge
          dueDate={row.original.dueDate}
          status={row.original.status}
          showIcon={false}
          className="text-xs font-normal"
        />
      ) : (
        <Empty />
      ),
  }),
  helper.accessor('createdAt', {
    header: 'Created',
    cell: ({ row }) => <TimestampText ms={row.original.createdAt} />,
  }),
  helper.accessor('completedAt', {
    header: 'Completed',
    cell: ({ row }) => <TimestampText ms={row.original.completedAt} />,
  }),
])

const GRID_TEMPLATE = columns
  .map((c) => COLUMN_WIDTHS[(c.id ?? ('accessorKey' in c ? c.accessorKey : '')) as ListColumnId])
  .join(' ')

// --- rows --------------------------------------------------------------------------------

interface TaskRowProps {
  row: ListTableRow
  task: Task
  start: number
  selected: boolean
  cursor: boolean
  onActivate(id: string): void
}

const TaskRow = memo(function TaskRow({
  row,
  task,
  start,
  selected,
  cursor,
  onActivate,
}: TaskRowProps) {
  const done = task.status === 'done'
  return (
    <TaskContextMenu task={task}>
      <div
        role="row"
        data-task-id={task.id}
        aria-selected={selected}
        data-cursor={cursor || undefined}
        onClick={(e) => {
          // Clicks that bubble (via React portals) from menus are not row clicks.
          if (!e.currentTarget.contains(e.target as Node)) return
          onActivate(task.id)
        }}
        className={cn(
          'absolute inset-x-0 top-0 grid cursor-default items-center border-b border-border/60 px-3 text-[13px]',
          'hover:bg-muted/50',
          selected && 'bg-selection hover:bg-selection',
          cursor && 'group-focus/list:shadow-[inset_2px_0_0_var(--color-primary)]',
          done && 'text-muted-foreground',
        )}
        style={{
          gridTemplateColumns: GRID_TEMPLATE,
          height: ROW_HEIGHT,
          transform: `translateY(${start}px)`,
        }}
      >
        {row.getAllCells().map((cell) => (
          <div
            key={cell.id}
            role="cell"
            data-col={cell.column.id}
            className={cn(
              'flex min-w-0 items-center px-2',
              done && cell.column.id !== 'status' && 'opacity-80',
            )}
          >
            {flexRender(cell.column.columnDef.cell, cell.getContext())}
          </div>
        ))}
      </div>
    </TaskContextMenu>
  )
})

function GroupRow({ group, start }: { group: ListGroupRow; start: number }) {
  const toggle = useListViewStore((s) => s.toggleCollapsed)
  return (
    <div
      role="row"
      data-group={group.key}
      className="absolute inset-x-0 top-0 flex items-center border-b border-border/60 bg-column px-3"
      style={{ height: ROW_HEIGHT, transform: `translateY(${start}px)` }}
    >
      <button
        type="button"
        aria-expanded={!group.collapsed}
        onClick={() => toggle(group.key)}
        className="flex h-6 items-center gap-2 rounded-md px-1.5 text-xs font-medium outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <ChevronRight
          className={cn(
            'size-3.5 text-muted-foreground transition-transform',
            !group.collapsed && 'rotate-90',
          )}
        />
        {group.status && <StatusIcon status={group.status} />}
        {group.priority && <PriorityIcon priority={group.priority} />}
        {group.label}
        <span className="font-normal text-muted-foreground tabular-nums">{group.count}</span>
      </button>
    </div>
  )
}

// --- toolbar -----------------------------------------------------------------------------

const GROUP_OPTIONS: Array<{ value: ListGroupBy; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'status', label: 'Status' },
  { value: 'priority', label: 'Priority' },
]

function ListToolbar({ counts }: { counts: Record<Status, number> }) {
  const groupBy = useListViewStore((s) => s.groupBy)
  const setGroupBy = useListViewStore((s) => s.setGroupBy)
  const statuses = useListViewStore((s) => s.statuses)
  const toggleStatus = useListViewStore((s) => s.toggleStatus)
  const groupLabel = GROUP_OPTIONS.find((o) => o.value === groupBy)?.label ?? 'None'
  return (
    <ToolbarControls>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <ToolbarButton
            icon={<Rows3 className="size-3.5" />}
            label={groupBy === 'none' ? 'Group' : groupLabel}
            hint={groupBy === 'none' ? 'Group rows' : `Grouped by ${groupLabel}`}
            aria-label={`Group by: ${groupLabel}`}
            active={groupBy !== 'none'}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-40">
          <DropdownMenuRadioGroup
            value={groupBy}
            onValueChange={(v) => setGroupBy(v as ListGroupBy)}
          >
            {GROUP_OPTIONS.map((o) => (
              <DropdownMenuRadioItem key={o.value} value={o.value}>
                {o.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <div role="group" aria-label="Status filter" className="ml-1 flex items-center gap-1">
        {STATUSES.map((s) => {
          const on = statuses.includes(s)
          return (
            <Tooltip key={s}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-pressed={on}
                  aria-label={STATUS_LABELS[s]}
                  data-status-chip={s}
                  onClick={() => toggleStatus(s)}
                  className={cn(
                    'flex h-6 items-center gap-1 rounded-full border px-2 text-xs whitespace-nowrap tabular-nums outline-none',
                    'focus-visible:ring-2 focus-visible:ring-ring/50',
                    on
                      ? 'border-border bg-secondary text-foreground hover:bg-accent'
                      : 'border-dashed text-muted-foreground/70 hover:bg-muted/60',
                  )}
                >
                  <StatusIcon status={s} className={cn(!on && 'opacity-40 grayscale')} />
                  {counts[s]}
                </button>
              </TooltipTrigger>
              <TooltipContent>
                {on ? 'Hide' : 'Show'} {STATUS_LABELS[s]}
              </TooltipContent>
            </Tooltip>
          )
        })}
      </div>
    </ToolbarControls>
  )
}

// --- view --------------------------------------------------------------------------------

export function ListView() {
  const allTasks = useTasks()
  const tasks = useFilteredTasks()
  const tagsById = useTagsById()
  const selectedTaskId = useUiStore((s) => s.selectedTaskId)
  const { sort, setSort, groupBy, statuses, collapsed } = useListViewStore()

  const sorted = useMemo(
    () => sortListTasks(filterByStatus(tasks, statuses), sort, tagsById),
    [tasks, statuses, sort, tagsById],
  )
  const counts = useMemo(() => {
    const c: Record<Status, number> = { not_started: 0, in_progress: 0, blocked: 0, done: 0 }
    for (const t of tasks) c[t.status]++
    return c
  }, [tasks])
  const rows: ListRow[] = useMemo(
    () => buildListRows(sorted, groupBy, collapsed),
    [sorted, groupBy, collapsed],
  )

  const sorting: SortingState = useMemo(() => (sort ? [sort] : []), [sort])
  const onSortingChange = useCallback(
    (updater: Updater<SortingState>) => {
      const next = typeof updater === 'function' ? updater(sorting) : updater
      const first = next[0]
      setSort(first ? { id: first.id as ListColumnId, desc: first.desc } : null)
    },
    [sorting, setSort],
  )
  const table = useTable({
    features,
    columns,
    data: sorted,
    getRowId: (t) => t.id,
    state: { sorting },
    onSortingChange,
    manualSorting: true,
    enableMultiSort: false,
    enableSortingRemoval: true,
    sortDescFirst: false,
  })
  const rowsById = table.getRowModel().rowsById

  const scrollRef = useRef<HTMLDivElement>(null)
  // No React Compiler in this project; the rule is informational for useVirtualizer.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    getItemKey: (i) => rows[i]?.key ?? i,
    overscan: 10,
    scrollMargin: HEADER_HEIGHT,
    scrollPaddingStart: HEADER_HEIGHT,
    initialRect: { width: 1200, height: 800 },
  })

  // Keyboard cursor: follows the selected task; Up/Down move it, Enter opens it.
  const [cursorId, setCursorId] = useState<string | null>(selectedTaskId)
  useEffect(() => {
    if (selectedTaskId) setCursorId(selectedTaskId)
  }, [selectedTaskId])

  const moveCursor = (id: string | null): void => {
    if (!id) return
    setCursorId(id)
    const index = rows.findIndex((r) => r.type === 'task' && r.task.id === id)
    if (index >= 0) virtualizer.scrollToIndex(index, { align: 'auto' })
    // With the detail panel open, it follows the cursor.
    if (useUiStore.getState().selectedTaskId) useUiStore.getState().selectTask(id)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    // Ignore keys from portalled menus and from inline controls / inputs.
    if (!e.currentTarget.contains(e.target as Node)) return
    if (e.target !== e.currentTarget && (e.target as HTMLElement).closest('[data-row-control]'))
      return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      moveCursor(adjacentTaskId(rows, cursorId, e.key === 'ArrowDown' ? 1 : -1))
    } else if (e.key === 'Enter' && cursorId) {
      e.preventDefault()
      useUiStore.getState().selectTask(cursorId)
    }
  }

  const onActivate = useCallback((id: string) => {
    setCursorId(id)
    useUiStore.getState().selectTask(id)
    scrollRef.current?.focus({ preventScroll: true })
  }, [])

  const headers = table.getHeaderGroups()[0]?.headers ?? []
  const empty = rows.length === 0

  return (
    <div className="flex h-full flex-col" data-testid="list-view">
      <ListToolbar counts={counts} />
      <div
        ref={scrollRef}
        role="table"
        aria-label="Tasks"
        aria-rowcount={sorted.length}
        tabIndex={0}
        onKeyDown={onKeyDown}
        className="group/list min-h-0 flex-1 scrollbar-thin overflow-auto outline-none"
      >
        <div style={{ minWidth: MIN_TABLE_WIDTH }}>
          <div
            role="row"
            className="sticky top-0 z-10 grid items-center border-b bg-background px-3 text-xs text-muted-foreground"
            style={{ gridTemplateColumns: GRID_TEMPLATE, height: HEADER_HEIGHT }}
          >
            {headers.map((header) => {
              const dir = header.column.getIsSorted()
              return (
                <div
                  key={header.id}
                  role="columnheader"
                  aria-sort={dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : 'none'}
                  className="flex min-w-0 items-center px-1"
                >
                  <button
                    type="button"
                    data-sort-col={header.column.id}
                    onClick={header.column.getToggleSortingHandler()}
                    className={cn(
                      'flex h-6 min-w-0 items-center gap-1 rounded-md px-1 font-medium whitespace-nowrap outline-none',
                      'hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50',
                      dir && 'text-foreground',
                    )}
                    title={`Sort by ${String(header.column.columnDef.header)}`}
                  >
                    <span className="truncate">
                      {header.column.id === 'status' ? (
                        <StatusIcon
                          status="done"
                          className="text-muted-foreground"
                          aria-label="Status"
                        />
                      ) : (
                        String(header.column.columnDef.header)
                      )}
                    </span>
                    {dir === 'asc' && <ArrowUp className="size-3 shrink-0" aria-hidden />}
                    {dir === 'desc' && <ArrowDown className="size-3 shrink-0" aria-hidden />}
                  </button>
                </div>
              )
            })}
          </div>

          {!empty && (
            <div
              role="rowgroup"
              className="relative"
              style={{ height: virtualizer.getTotalSize() }}
            >
              {virtualizer.getVirtualItems().map((item) => {
                const r = rows[item.index]
                if (!r) return null
                const start = item.start - HEADER_HEIGHT
                if (r.type === 'group') return <GroupRow key={r.key} group={r} start={start} />
                const row = rowsById[r.task.id]
                if (!row) return null
                return (
                  <TaskRow
                    key={r.key}
                    row={row}
                    task={r.task}
                    start={start}
                    selected={r.task.id === selectedTaskId}
                    cursor={r.task.id === cursorId}
                    onActivate={onActivate}
                  />
                )
              })}
            </div>
          )}
        </div>
        {empty && (
          <p className="px-6 py-8 text-[13px] text-muted-foreground" data-testid="list-empty">
            {allTasks.length === 0
              ? `No tasks yet. Press ${modKeyLabel()}N to add one.`
              : 'No tasks match the current filters.'}
          </p>
        )}
      </div>
    </div>
  )
}

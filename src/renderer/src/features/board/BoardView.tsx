// PLACEHOLDER — owned by the board feature. Replace this file's contents (keep the export
// name and props). Spec §6 "Board (Kanban)".
import { FileText } from 'lucide-react'
import { useMemo } from 'react'
import { STATUSES, STATUS_LABELS } from '@shared/constants'
import type { BoardScope, BoardSort, Task } from '@shared/types'
import { boardColumns, checklistProgress, hasDescription } from '@shared/views'
import { ToolbarControls } from '@/app/ToolbarControls'
import {
  DueDateBadge,
  PriorityIcon,
  StatusIcon,
  TaskContextMenu,
  TaskTags,
} from '@/components/task'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useToday } from '@/lib/useToday'
import { cn } from '@/lib/utils'
import { useFilteredTasks, useSettings } from '@/stores/selectors'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUiStore } from '@/stores/uiStore'

export interface BoardViewProps {
  scope: BoardScope
}

const SORTS: Array<{ value: BoardSort; label: string }> = [
  { value: 'priority', label: 'Priority' },
  { value: 'due', label: 'Due' },
  { value: 'manual', label: 'Manual' },
]

function Card({ task }: { task: Task }) {
  const selected = useUiStore((s) => s.selectedTaskId === task.id)
  const progress = checklistProgress(task.description)
  return (
    <TaskContextMenu task={task}>
      <button
        type="button"
        data-task-id={task.id}
        onClick={() => useUiStore.getState().selectTask(task.id)}
        className={cn(
          'flex w-full flex-col gap-1.5 rounded-md border bg-card p-2.5 text-left shadow-xs outline-none',
          'hover:border-zinc-300 focus-visible:ring-2 focus-visible:ring-ring/50 dark:hover:border-zinc-600',
          selected && 'border-primary/60 ring-1 ring-primary/40',
        )}
      >
        <span
          className={cn(
            'text-[13px] leading-snug',
            task.status === 'done' && 'text-muted-foreground line-through',
          )}
        >
          {task.title}
        </span>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <PriorityIcon priority={task.priority} />
          <DueDateBadge dueDate={task.dueDate} status={task.status} />
          {hasDescription(task) && (
            <FileText className="size-3 text-muted-foreground" aria-label="Has description" />
          )}
          {progress && (
            <span className="text-[11px] text-muted-foreground tabular-nums">
              {progress.done}/{progress.total}
            </span>
          )}
          <TaskTags tagIds={task.tagIds} />
        </span>
      </button>
    </TaskContextMenu>
  )
}

export function BoardView({ scope }: BoardViewProps) {
  const tasks = useFilteredTasks()
  const today = useToday()
  const settings = useSettings()
  const sort = settings.boardSort[scope]
  const columns = useMemo(
    () => boardColumns(scope, tasks, today, settings, sort),
    [scope, tasks, today, settings, sort],
  )

  return (
    <div className="flex h-full gap-3 overflow-x-auto p-4" data-testid={`board-${scope}`}>
      {/* Example of the toolbar-controls mechanism: the sort selector lives in the shell toolbar. */}
      <ToolbarControls>
        <ToggleGroup
          type="single"
          size="sm"
          variant="outline"
          value={sort}
          onValueChange={(v) =>
            v && void useSettingsStore.getState().set({ boardSort: { [scope]: v as BoardSort } })
          }
          aria-label="Sort"
        >
          {SORTS.map((s) => (
            <ToggleGroupItem key={s.value} value={s.value} className="h-7 px-2.5 text-xs">
              {s.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </ToolbarControls>

      {STATUSES.map((status) => (
        <section
          key={status}
          className="flex w-72 shrink-0 flex-col rounded-lg bg-column"
          aria-label={STATUS_LABELS[status]}
        >
          <header className="flex h-9 items-center gap-2 px-3 text-xs font-medium">
            <StatusIcon status={status} />
            {STATUS_LABELS[status]}
            <span className="text-muted-foreground tabular-nums">{columns[status].length}</span>
          </header>
          <div className="flex min-h-0 flex-1 scrollbar-thin flex-col gap-1.5 overflow-y-auto px-2 pb-2">
            {columns[status].map((t) => (
              <Card key={t.id} task={t} />
            ))}
            {columns[status].length === 0 && (
              <p className="px-1 py-2 text-xs text-muted-foreground">No tasks</p>
            )}
          </div>
        </section>
      ))}
    </div>
  )
}

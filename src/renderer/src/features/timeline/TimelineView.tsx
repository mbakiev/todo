// PLACEHOLDER — owned by the timeline feature. Replace this file's contents (keep the export
// name). Spec §6 "Timeline (Gantt)".
import { useMemo } from 'react'
import { formatShortDate } from '@shared/dates'
import { filterTimeline, isOverdue, taskSpan } from '@shared/views'
import { PriorityIcon, TaskContextMenu } from '@/components/task'
import { useToday } from '@/lib/useToday'
import { cn } from '@/lib/utils'
import { useFilteredTasks } from '@/stores/selectors'
import { useUiStore } from '@/stores/uiStore'

export function TimelineView() {
  const tasks = useFilteredTasks()
  const today = useToday()
  const rows = useMemo(() => filterTimeline(tasks), [tasks])
  return (
    <div className="h-full overflow-auto p-4" data-testid="timeline-view">
      <ul className="flex flex-col gap-1">
        {rows.map((t) => {
          const span = taskSpan(t)
          return (
            <TaskContextMenu key={t.id} task={t}>
              <li
                className="flex items-center gap-2 rounded-md px-2 py-1 text-[13px] hover:bg-muted/50"
                onClick={() => useUiStore.getState().selectTask(t.id)}
                data-task-id={t.id}
              >
                <PriorityIcon priority={t.priority} />
                <span className="flex-1 truncate">{t.title}</span>
                <span
                  className={cn(
                    'text-xs text-muted-foreground tabular-nums',
                    isOverdue(t, today) && 'text-overdue',
                  )}
                >
                  {span &&
                    (span.start === span.end
                      ? formatShortDate(span.start, today)
                      : `${formatShortDate(span.start, today)} → ${formatShortDate(span.end, today)}`)}
                </span>
              </li>
            </TaskContextMenu>
          )
        })}
      </ul>
      {rows.length === 0 && <p className="text-xs text-muted-foreground">No dated open tasks.</p>}
    </div>
  )
}

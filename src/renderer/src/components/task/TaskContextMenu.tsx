// Right-click menu for any task element (spec §6 "Shared across all views").
import { CalendarDays, CalendarX2, PanelRightOpen, Trash2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { PRIORITIES, PRIORITY_LABELS, STATUSES, STATUS_LABELS } from '@shared/constants'
import { presetDate, type DatePreset } from '@shared/dates'
import type { Task } from '@shared/types'
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { getToday } from '@/lib/useToday'
import { useSettingsStore } from '@/stores/settingsStore'
import { useTasksStore } from '@/stores/tasksStore'
import { useUiStore } from '@/stores/uiStore'
import { deleteTaskWithUndo } from './deleteTaskWithUndo'
import { PriorityIcon } from './PriorityIcon'
import { StatusIcon } from './StatusIcon'

export interface TaskContextMenuProps {
  task: Task
  /** The element(s) that open the menu on right-click. Rendered via `asChild`. */
  children: ReactNode
  /** Extra items rendered above "Delete" (view-specific actions). */
  extraItems?: ReactNode
}

const DUE_PRESETS: Array<{ preset: DatePreset; label: string }> = [
  { preset: 'today', label: 'Today' },
  { preset: 'tomorrow', label: 'Tomorrow' },
  { preset: 'nextWeek', label: 'Next week' },
]

/** Sets the due date, moving the start date back if it would end up after the due date. */
function setDue(task: Task, due: string | null): void {
  const patch: { dueDate: string | null; startDate?: string | null } = { dueDate: due }
  if (due && task.startDate && task.startDate > due) patch.startDate = due
  void useTasksStore.getState().update(task.id, patch)
}

export function TaskContextMenu({ task, children, extraItems }: TaskContextMenuProps) {
  const update = (
    patch: Parameters<ReturnType<typeof useTasksStore.getState>['update']>[1],
  ): void => void useTasksStore.getState().update(task.id, patch)

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        <ContextMenuItem onSelect={() => useUiStore.getState().selectTask(task.id)}>
          <PanelRightOpen />
          Open
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <StatusIcon status={task.status} />
            Status
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-44">
            {STATUSES.map((s) => (
              <ContextMenuCheckboxItem
                key={s}
                checked={task.status === s}
                onSelect={() => update({ status: s })}
              >
                <StatusIcon status={s} />
                {STATUS_LABELS[s]}
              </ContextMenuCheckboxItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <PriorityIcon priority={task.priority} />
            Priority
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-44">
            {PRIORITIES.map((p) => (
              <ContextMenuCheckboxItem
                key={p}
                checked={task.priority === p}
                onSelect={() => update({ priority: p })}
              >
                <PriorityIcon priority={p} />
                {PRIORITY_LABELS[p]}
              </ContextMenuCheckboxItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <CalendarDays />
            Due date
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-44">
            {DUE_PRESETS.map(({ preset, label }) => (
              <ContextMenuItem
                key={preset}
                onSelect={() =>
                  setDue(
                    task,
                    presetDate(
                      preset,
                      getToday(),
                      useSettingsStore.getState().settings.weekStartsOn,
                    ),
                  )
                }
              >
                {label}
              </ContextMenuItem>
            ))}
            <ContextMenuSeparator />
            <ContextMenuItem disabled={!task.dueDate} onSelect={() => setDue(task, null)}>
              <CalendarX2 />
              Clear
            </ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>
        {extraItems}
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onSelect={() => void deleteTaskWithUndo(task.id)}>
          <Trash2 />
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

// PLACEHOLDER — owned by the task-detail+editor feature. Replace this file's contents (keep
// the export name and props). Spec §7: resizable ~480px panel, autosave, Copy as Markdown.
import { Trash2, X } from 'lucide-react'
import { useState } from 'react'
import type { Task } from '@shared/types'
import {
  DatePickerField,
  PrioritySelect,
  StatusSelect,
  TagPicker,
  TaskTags,
  deleteTaskWithUndo,
} from '@/components/task'
import { Button } from '@/components/ui/button'
import { MarkdownEditor } from '@/features/editor/MarkdownEditor'
import { useSettings, useTask } from '@/stores/selectors'
import { useTasksStore } from '@/stores/tasksStore'
import { useUiStore } from '@/stores/uiStore'

export interface TaskDetailPanelProps {
  taskId: string
}

export function TaskDetailPanel({ taskId }: TaskDetailPanelProps) {
  const task = useTask(taskId)
  if (!task) return null
  // Keyed so drafts reset when switching tasks.
  return <Panel key={task.id} task={task} />
}

function Panel({ task }: { task: Task }) {
  const { detailPanelWidth } = useSettings()
  const update = useTasksStore((s) => s.update)
  const [title, setTitle] = useState(task.title)
  const [description, setDescription] = useState(task.description)

  const close = (): void => useUiStore.getState().selectTask(null)
  const saveTitle = (): void => {
    if (title.trim() && title !== task.title) void update(task.id, { title })
  }
  const saveDescription = (): void => {
    if (description !== task.description) void update(task.id, { description })
  }

  return (
    <div
      className="flex h-full flex-col border-l bg-background"
      style={{ width: detailPanelWidth }}
      data-testid="task-detail"
    >
      <div className="flex h-12 shrink-0 items-center justify-end gap-1 border-b px-3">
        <Button
          variant="ghost"
          size="sm"
          className="size-7 p-0"
          onClick={() => void deleteTaskWithUndo(task.id)}
          aria-label="Delete task"
        >
          <Trash2 className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="size-7 p-0"
          onClick={close}
          aria-label="Close panel"
        >
          <X className="size-3.5" />
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
        <input
          className="bg-transparent text-lg font-semibold outline-none"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={saveTitle}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          aria-label="Title"
        />
        <div className="grid grid-cols-[96px_1fr] items-center gap-y-1 text-[13px]">
          <span className="text-muted-foreground">Status</span>
          <StatusSelect
            value={task.status}
            onChange={(status) => void update(task.id, { status })}
            className="justify-self-start"
          />
          <span className="text-muted-foreground">Priority</span>
          <PrioritySelect
            value={task.priority}
            onChange={(priority) => void update(task.id, { priority })}
            className="justify-self-start"
          />
          <span className="text-muted-foreground">Start</span>
          <DatePickerField
            value={task.startDate}
            max={task.dueDate}
            onChange={(startDate) => void update(task.id, { startDate })}
            className="justify-self-start"
          />
          <span className="text-muted-foreground">Due</span>
          <DatePickerField
            value={task.dueDate}
            min={task.startDate}
            onChange={(dueDate) => void update(task.id, { dueDate })}
            className="justify-self-start"
          />
          <span className="text-muted-foreground">Tags</span>
          <div className="flex items-center gap-1">
            <TaskTags tagIds={task.tagIds} max={10} />
            <TagPicker
              value={task.tagIds}
              onChange={(tagIds) => void update(task.id, { tagIds })}
            />
          </div>
        </div>
        <MarkdownEditor value={description} onChange={setDescription} onBlur={saveDescription} />
      </div>
    </div>
  )
}

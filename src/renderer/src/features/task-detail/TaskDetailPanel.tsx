// Task detail side panel (spec §7): inline-editable title, property rows, Markdown description,
// timestamps, Copy as Markdown and Delete. Everything autosaves; nothing typed is ever lost.
import { format, formatDistanceToNowStrict } from 'date-fns'
import { Check, Copy, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import type { UpdateTaskPatch } from '@shared/ipc'
import type { Task } from '@shared/types'
import { isDueToday, isOverdue } from '@shared/views'
import {
  DatePickerField,
  PrioritySelect,
  StatusSelect,
  TagChip,
  TagPicker,
  deleteTaskWithUndo,
} from '@/components/task'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { MarkdownEditor } from '@/features/editor/MarkdownEditor'
import { registerFlusher } from '@/lib/flush'
import { cn } from '@/lib/utils'
import { useToday } from '@/lib/useToday'
import { useTagsById, useTask } from '@/stores/selectors'
import { isTempId, useTasksStore } from '@/stores/tasksStore'
import { useUiStore } from '@/stores/uiStore'
import { copyText } from './copyText'
import { resolvedId, saveTaskPatch } from './saveTask'
import { taskToMarkdown } from './taskMarkdown'
import { useDraftField } from './useDraftField'
import { usePanelWidth } from './usePanelWidth'

export interface TaskDetailPanelProps {
  taskId: string
}

const close = (): void => useUiStore.getState().selectTask(null)

/**
 * Stable identity for the open task: a temp id resolving to its real id is the same task (keep
 * drafts and focus), anything else is a different task (remount → flush + fresh drafts).
 */
function useLogicalKey(taskId: string): string {
  const [state, setState] = useState({ id: taskId, key: taskId })
  if (state.id !== taskId) {
    const same = resolvedId(state.id) === taskId
    const next = { id: taskId, key: same ? state.key : taskId }
    setState(next)
    return next.key
  }
  return state.key
}

export function TaskDetailPanel({ taskId }: TaskDetailPanelProps) {
  const task = useTask(taskId)
  const loaded = useTasksStore((s) => s.loaded)
  const key = useLogicalKey(taskId)
  const { width, resizing, onResizeStart, reset } = usePanelWidth()

  // Deleted elsewhere (or a failed create): close. A temp id may briefly be missing while it
  // is swapped for the real one.
  const missing = loaded && !task && !isTempId(taskId)
  useEffect(() => {
    if (missing) close()
  }, [missing])

  return (
    <div
      className={cn(
        'relative flex h-full flex-col border-l bg-background',
        'animate-in duration-200 ease-out fade-in-0 slide-in-from-right-6',
      )}
      style={{ width }}
      data-testid="task-detail"
      data-resizing={resizing || undefined}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize panel"
        title="Drag to resize · double-click to reset"
        className={cn(
          'absolute inset-y-0 -left-1 z-20 w-2 cursor-col-resize',
          'after:absolute after:inset-y-0 after:left-1 after:w-px after:transition-colors',
          'hover:after:bg-ring/60',
          resizing && 'after:bg-ring',
        )}
        onPointerDown={onResizeStart}
        onDoubleClick={reset}
      />
      {task && <PanelBody key={key} task={task} />}
    </div>
  )
}

function PanelBody({ task }: { task: Task }) {
  // The same logical task for this component's lifetime (see useLogicalKey); only a temp id
  // can change here, to its real id.
  const idRef = useRef(task.id)
  useEffect(() => {
    idRef.current = task.id
  })
  const save = (patch: UpdateTaskPatch): void => saveTaskPatch(idRef.current, patch)
  const today = useToday()
  const tagsById = useTagsById()

  const title = useDraftField({
    value: task.title,
    save: (v) => save({ title: v }),
    normalize: (v) => v.replace(/\s+/g, ' ').trim(),
    isValid: (v) => v.trim() !== '',
  })
  const description = useDraftField({
    value: task.description,
    save: (v) => save({ description: v }),
  })

  // Window hide / blur / reload are flush points too.
  const flushRef = useRef(() => {})
  useEffect(() => {
    flushRef.current = () => {
      title.flush()
      description.flush()
    }
  })
  useEffect(() => {
    const flush = (): void => flushRef.current()
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') flush()
    }
    const unregister = registerFlusher(flush) // main's hide/quit handshake
    window.addEventListener('blur', flush)
    window.addEventListener('beforeunload', flush)
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      unregister()
      window.removeEventListener('blur', flush)
      window.removeEventListener('beforeunload', flush)
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  const isDone = task.status === 'done'
  const dueTone = isOverdue(task, today) ? 'overdue' : isDueToday(task, today) ? 'today' : 'default'
  const tags = task.tagIds.map((id) => tagsById[id]).filter((t) => t !== undefined)

  const copyMarkdown = async (): Promise<void> => {
    flushRef.current()
    const text = taskToMarkdown(
      {
        ...task,
        title: title.draft.trim() ? title.draft : task.title,
        description: description.draft,
      },
      tagsById,
    )
    if (await copyText(text)) toast.success('Copied as Markdown')
    else toast.error("Couldn't copy to the clipboard")
  }

  const remove = (): void => {
    flushRef.current()
    void deleteTaskWithUndo(idRef.current)
  }

  return (
    <>
      <header className="flex h-12 shrink-0 items-center gap-1 border-b px-3">
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            'h-7 gap-1.5 px-2 text-[13px] font-normal',
            isDone ? 'text-status-done' : 'text-muted-foreground',
          )}
          onClick={() => save({ status: isDone ? 'not_started' : 'done' })}
          aria-pressed={isDone}
        >
          <span
            className={cn(
              'flex size-3.5 items-center justify-center rounded-full border-[1.5px]',
              isDone ? 'border-status-done bg-status-done text-background' : 'border-current',
            )}
          >
            {isDone && <Check className="size-2.5" strokeWidth={3} />}
          </span>
          {isDone ? 'Completed' : 'Mark complete'}
        </Button>
        <div className="flex-1" />
        <IconAction label="Close" shortcut="Esc" onClick={close}>
          <X />
        </IconAction>
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto" data-slot="detail-scroll">
        <div className="px-5 pt-4">
          <textarea
            value={title.draft}
            rows={1}
            aria-label="Title"
            placeholder="Task title"
            spellCheck
            className={cn(
              '[field-sizing:content] w-full resize-none bg-transparent text-[19px] leading-snug font-semibold tracking-[-0.01em] outline-none',
              'placeholder:text-muted-foreground/60',
              isDone && 'text-muted-foreground',
            )}
            onChange={(e) => title.change(e.target.value.replace(/[\r\n]+/g, ' '))}
            onBlur={title.commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === 'Escape') {
                e.preventDefault()
                e.currentTarget.blur()
              }
            }}
          />
        </div>

        <dl className="grid grid-cols-[88px_minmax(0,1fr)] items-center gap-y-0.5 px-5 pt-2 pb-3 text-[13px]">
          <PropLabel>Status</PropLabel>
          <dd>
            <StatusSelect
              value={task.status}
              onChange={(status) => save({ status })}
              className="-ml-2"
            />
          </dd>
          <PropLabel>Priority</PropLabel>
          <dd>
            <PrioritySelect
              value={task.priority}
              onChange={(priority) => save({ priority })}
              className="-ml-2"
            />
          </dd>
          <PropLabel>Start date</PropLabel>
          <dd>
            <DatePickerField
              value={task.startDate}
              max={task.dueDate}
              placeholder="No start date"
              onChange={(startDate) => save({ startDate })}
              className="-ml-2"
            />
          </dd>
          <PropLabel>Due date</PropLabel>
          <dd>
            <DatePickerField
              value={task.dueDate}
              min={task.startDate}
              tone={dueTone}
              placeholder="No due date"
              onChange={(dueDate) => save({ dueDate })}
              className="-ml-2"
            />
          </dd>
          <PropLabel className="self-start pt-1.5">Tags</PropLabel>
          <dd
            className="flex min-h-7 flex-wrap items-center gap-1 py-0.5"
            data-testid="detail-tags"
          >
            {tags.map((t) => (
              <TagChip
                key={t.id}
                tag={t}
                size="md"
                className="h-[22px] text-[12px]"
                onRemove={() => save({ tagIds: task.tagIds.filter((id) => id !== t.id) })}
              />
            ))}
            <TagPicker
              value={task.tagIds}
              onChange={(tagIds) => save({ tagIds })}
              trigger={
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    'h-6 px-1.5 text-[12px] font-normal text-muted-foreground',
                    tags.length === 0 && '-ml-1.5',
                  )}
                >
                  {tags.length === 0 ? 'Add tags' : '+ Tag'}
                </Button>
              }
            />
          </dd>
        </dl>

        <div className="mx-5 border-t" />

        <MarkdownEditor
          value={description.draft}
          onChange={description.change}
          onBlur={description.flush}
          className="flex-1 px-5 pt-3"
        />
      </div>

      <footer className="flex h-11 shrink-0 items-center gap-2 border-t px-3 text-[11.5px] text-muted-foreground">
        <div className="flex min-w-0 flex-1 items-center gap-2.5 truncate pl-2">
          <Timestamp label="Created" at={task.createdAt} />
          <Timestamp label="Updated" at={task.updatedAt} />
          {task.completedAt !== null && <Timestamp label="Completed" at={task.completedAt} />}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 px-2 text-[12px] font-normal text-muted-foreground"
          onClick={() => void copyMarkdown()}
        >
          <Copy className="size-3.5" />
          Copy as Markdown
        </Button>
        <IconAction label="Delete task" onClick={remove} destructive>
          <Trash2 />
        </IconAction>
      </footer>
    </>
  )
}

function PropLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <dt className={cn('text-muted-foreground', className)}>{children}</dt>
}

function IconAction({
  label,
  shortcut,
  onClick,
  destructive,
  children,
}: {
  label: string
  shortcut?: string
  onClick(): void
  destructive?: boolean
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label={label}
          onClick={onClick}
          className={cn(
            'size-7 p-0 text-muted-foreground [&_svg]:size-3.5',
            destructive && 'hover:bg-destructive/10 hover:text-destructive',
          )}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="px-2 py-1">
        {label}
        {shortcut && <span className="ml-1.5 opacity-60">{shortcut}</span>}
      </TooltipContent>
    </Tooltip>
  )
}

function relative(at: number): string {
  if (Date.now() - at < 45_000) return 'just now'
  return formatDistanceToNowStrict(at, { addSuffix: true })
}

function Timestamp({ label, at }: { label: string; at: number }) {
  // Re-render once a minute so "just now" ages.
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 60_000)
    return () => clearInterval(t)
  }, [])
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="cursor-default truncate">
          {label} {relative(at)}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="px-2 py-1">
        {label} {format(at, "MMM d, yyyy 'at' h:mm a")}
      </TooltipContent>
    </Tooltip>
  )
}

// Task detail side panel (spec §7): inline-editable title, property rows, Markdown description,
// timestamps, Copy as Markdown and Delete. Everything autosaves; nothing typed is ever lost.
import { format, formatDistanceToNowStrict } from 'date-fns'
import { AlertCircle, Check, Copy, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { MAX_DESCRIPTION_LENGTH, MAX_TITLE_LENGTH } from '@shared/constants'
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
import {
  clearUnsavedDraft,
  defaultStorage,
  recoverableDraft,
  storeUnsavedDraft,
  type DraftFieldName,
} from '@/lib/draftRecovery'
import { registerFlusher } from '@/lib/flush'
import { formatShortcut } from '@/lib/shortcuts'
import { cn } from '@/lib/utils'
import { useToday } from '@/lib/useToday'
import { useTagsById, useTask, useTaskTags } from '@/stores/selectors'
import { isTempId, useTasksStore } from '@/stores/tasksStore'
import { setLeaveGuard, useUiStore } from '@/stores/uiStore'
import { copyText } from './copyText'
import { resolvedId, saveTaskPatch } from './saveTask'
import { taskToMarkdown } from './taskMarkdown'
import { useDraftField, type DraftStatus } from './useDraftField'
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
  const save = (patch: UpdateTaskPatch): Promise<boolean> => saveTaskPatch(idRef.current, patch)
  const today = useToday()
  const tagsById = useTagsById()

  // Unsaved text that could not be saved is kept in localStorage (lib/draftRecovery.ts) so a
  // hide / quit / crash cannot lose it; opening the task offers it back (Keep / Discard).
  const storage = defaultStorage()
  const realId = (): string | null => {
    const id = resolvedId(idRef.current)
    return isTempId(id) ? null : id
  }
  const keepUnsaved = (field: DraftFieldName, text: string): void => {
    const id = realId()
    if (!id) return
    storeUnsavedDraft(storage, {
      taskId: id,
      field,
      text,
      taskUpdatedAt: useTasksStore.getState().byId[id]?.updatedAt ?? 0,
      storedAt: Date.now(),
    })
  }
  const forgetUnsaved = (field: DraftFieldName): void => {
    const id = realId()
    if (id) clearUnsavedDraft(storage, id, field)
  }
  const [recovered] = useState(() => ({
    title: recoverableDraft(storage, task, 'title', task.title),
    description: recoverableDraft(storage, task, 'description', task.description),
  }))

  const title = useDraftField({
    value: task.title,
    save: (v) => save({ title: v }),
    normalize: (v) => v.replace(/\s+/g, ' ').trim(),
    isValid: (v) => v.trim() !== '' && v.length <= MAX_TITLE_LENGTH,
    onSaveFailed: (text) => keepUnsaved('title', text),
    onSaveSucceeded: () => forgetUnsaved('title'),
    recovered: recovered.title?.text ?? null,
    onDiscardRecovered: () => forgetUnsaved('title'),
  })
  const description = useDraftField({
    value: task.description,
    save: (v) => save({ description: v }),
    isValid: (v) => v.length <= MAX_DESCRIPTION_LENGTH,
    onSaveFailed: (text) => keepUnsaved('description', text),
    onSaveSucceeded: () => forgetUnsaved('description'),
    recovered: recovered.description?.text ?? null,
    onDiscardRecovered: () => forgetUnsaved('description'),
  })

  // Latest field handles for the long-lived listeners below.
  const fieldsRef = useRef({ title, description })
  useEffect(() => {
    fieldsRef.current = { title, description }
  })
  const flush = (): Promise<unknown> => {
    const f = fieldsRef.current
    return Promise.all([f.title.flushAsync(), f.description.flushAsync()])
  }

  /**
   * Saves everything before the panel closes, switches task or deletes it. True when nothing
   * typed is left unsaved (after one retry); otherwise the panel must stay open.
   */
  const saveBeforeLeaving = async (): Promise<boolean> => {
    const f = fieldsRef.current
    if (f.title.status === 'invalid') f.title.commit() // an emptied title reverts, as on blur
    if (f.description.status === 'invalid') {
      toast.error('The description is too long to save', {
        description: 'Shorten it first; the panel stays open so nothing you typed is lost.',
      })
      return false
    }
    const attempt = async (): Promise<boolean> =>
      (await Promise.all([f.title.flushAsync(), f.description.flushAsync()])).every(Boolean)
    const ok = (await attempt()) || (await attempt())
    if (!ok) {
      toast.error("Couldn't save your changes", {
        description:
          'The panel stays open so nothing you typed is lost. Use Retry, or try again in a moment.',
      })
    }
    return ok
  }
  const leaveRef = useRef(saveBeforeLeaving)
  useEffect(() => {
    leaveRef.current = saveBeforeLeaving
  })
  useEffect(
    () =>
      setLeaveGuard(() => {
        const f = fieldsRef.current
        return f.title.dirty || f.description.dirty ? leaveRef.current() : null
      }),
    [],
  )

  useEffect(() => {
    const flushNow = (): void => void flush()
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') flushNow()
    }
    // A reload / crash recovery gives the answers no page to come back to: keep what is still
    // unsaved now (an obsolete copy is dropped when the task is next opened).
    const onUnload = (): void => {
      const f = fieldsRef.current
      for (const field of ['title', 'description'] as const) {
        const d = f[field]
        if (d.dirty && d.status !== 'recovered') keepUnsaved(field, d.draft)
      }
      flushNow()
    }
    const unregister = registerFlusher(flush) // main's hide/quit handshake
    window.addEventListener('blur', flushNow)
    window.addEventListener('beforeunload', onUnload)
    window.addEventListener('pagehide', onUnload)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      unregister()
      window.removeEventListener('blur', flushNow)
      window.removeEventListener('beforeunload', onUnload)
      window.removeEventListener('pagehide', onUnload)
      document.removeEventListener('visibilitychange', onVisibility)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reads only refs / stable helpers
  }, [])

  const isDone = task.status === 'done'
  const dueTone = isOverdue(task, today) ? 'overdue' : isDueToday(task, today) ? 'today' : 'default'
  const tags = useTaskTags(task.tagIds)

  const copyMarkdown = async (): Promise<void> => {
    void flush()
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

  const remove = async (): Promise<void> => {
    // Deleting would take unsaved text with it: save first, or stay.
    if (await saveBeforeLeaving()) void deleteTaskWithUndo(idRef.current)
  }

  return (
    <>
      {/* Same height as the toolbar beside it (one or two rows), so the bottom borders line up. */}
      <header
        className="app-drag flex h-[var(--toolbar-height,3rem)] shrink-0 items-center gap-1 border-b px-3"
        data-testid="detail-header"
      >
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
        <IconAction label="Close" shortcut="Escape" onClick={close}>
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
            maxLength={MAX_TITLE_LENGTH}
            aria-invalid={title.status === 'failed' || undefined}
            onChange={(e) =>
              title.change(e.target.value.replace(/[\r\n]+/g, ' ').slice(0, MAX_TITLE_LENGTH))
            }
            onBlur={title.commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === 'Escape') {
                e.preventDefault()
                e.currentTarget.blur()
              }
            }}
          />
          <DraftNotice
            field="title"
            status={title.status}
            onRetry={title.retry}
            onKeep={title.keepRecovered}
            onDiscard={title.discardRecovered}
            changedSince={recovered.title?.changedSince ?? false}
            hint={
              title.draft.length >= MAX_TITLE_LENGTH
                ? `Titles can be at most ${MAX_TITLE_LENGTH.toLocaleString()} characters.`
                : null
            }
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

        <DraftNotice
          field="description"
          status={description.status}
          onRetry={description.retry}
          onKeep={description.keepRecovered}
          onDiscard={description.discardRecovered}
          changedSince={recovered.description?.changedSince ?? false}
          invalidText={`Too long to save: ${description.draft.length.toLocaleString()} of ${MAX_DESCRIPTION_LENGTH.toLocaleString()} characters. Shorten it and it saves again.`}
          className="mx-5 mt-2"
        />
        <MarkdownEditor
          value={description.draft}
          onChange={description.change}
          onBlur={description.flush}
          className="flex-1 px-5 pt-3"
        />
      </div>

      {/* Narrow panel (< 440px): only "Updated …" (every timestamp in its tooltip) and an
          icon-only Copy button, so nothing truncates mid-word. */}
      <footer className="@container/footer shrink-0 border-t">
        <div className="flex h-11 items-center gap-2 px-3 text-[11.5px] text-muted-foreground">
          <div className="flex min-w-0 flex-1 items-center gap-2.5 pl-2">
            <Timestamp
              label="Created"
              at={task.createdAt}
              task={task}
              // With a completion time too, "Created" makes room earlier.
              className={cn(
                '@max-[440px]/footer:hidden',
                task.completedAt !== null && '@max-[600px]/footer:hidden',
              )}
            />
            <Timestamp label="Updated" at={task.updatedAt} task={task} />
            {task.completedAt !== null && (
              <Timestamp
                label="Completed"
                at={task.completedAt}
                task={task}
                className="@max-[440px]/footer:hidden"
              />
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            title="Copy as Markdown"
            className="h-7 shrink-0 gap-1.5 px-2 text-[12px] font-normal text-muted-foreground @max-[440px]/footer:w-7 @max-[440px]/footer:px-0"
            onClick={() => void copyMarkdown()}
          >
            <Copy className="size-3.5" />
            <span className="@max-[440px]/footer:sr-only">Copy as Markdown</span>
          </Button>
          <IconAction label="Delete task" onClick={() => void remove()} destructive>
            <Trash2 />
          </IconAction>
        </div>
      </footer>
    </>
  )
}

/**
 * Persistent save state under a draft field: "Not saved — Retry" after a failed save, the
 * reason when the draft cannot be saved, or an informational hint.
 */
function DraftNotice({
  field,
  status,
  onRetry,
  onKeep,
  onDiscard,
  changedSince,
  invalidText,
  hint,
  className,
}: {
  field: string
  status: DraftStatus
  onRetry(): void
  onKeep(): void
  onDiscard(): void
  /** Recovered text: the task was saved again after the text was kept. */
  changedSince: boolean
  invalidText?: string
  hint?: string | null
  className?: string
}) {
  if (status === 'recovered') {
    return (
      <p
        role="status"
        data-testid={`${field}-recovered`}
        className={cn(
          'flex flex-wrap items-center gap-x-1.5 text-[12px] text-due-today',
          className,
        )}
      >
        <AlertCircle className="size-3.5 shrink-0" />
        <span>Recovered unsaved text{changedSince ? ' (the task has changed since)' : ''}.</span>
        <button
          type="button"
          className="font-medium underline underline-offset-2 hover:no-underline"
          onClick={onKeep}
        >
          Keep
        </button>
        <span aria-hidden>·</span>
        <button
          type="button"
          className="font-medium underline underline-offset-2 hover:no-underline"
          onClick={onDiscard}
        >
          Discard
        </button>
      </p>
    )
  }
  if (status === 'failed') {
    return (
      <p
        role="alert"
        data-testid={`${field}-save-error`}
        className={cn('flex items-center gap-1.5 text-[12px] text-destructive', className)}
      >
        <AlertCircle className="size-3.5 shrink-0" />
        <span>Not saved.</span>
        <button
          type="button"
          className="font-medium underline underline-offset-2 hover:no-underline"
          onClick={onRetry}
        >
          Retry
        </button>
      </p>
    )
  }
  if (status === 'invalid' && invalidText) {
    return (
      <p
        role="alert"
        data-testid={`${field}-save-error`}
        className={cn('flex items-center gap-1.5 text-[12px] text-destructive', className)}
      >
        <AlertCircle className="size-3.5 shrink-0" />
        <span>{invalidText}</span>
      </p>
    )
  }
  if (hint) {
    return <p className={cn('text-[12px] text-muted-foreground', className)}>{hint}</p>
  }
  return null
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
        {shortcut && <span className="ml-1.5 opacity-60">{formatShortcut(shortcut)}</span>}
      </TooltipContent>
    </Tooltip>
  )
}

function relative(at: number): string {
  if (Date.now() - at < 45_000) return 'just now'
  return formatDistanceToNowStrict(at, { addSuffix: true })
}

function Timestamp({
  label,
  at,
  task,
  className,
}: {
  label: string
  at: number
  task: Task
  className?: string
}) {
  // Re-render once a minute so "just now" ages.
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 60_000)
    return () => clearInterval(t)
  }, [])
  const full = (ms: number): string => format(ms, "MMM d, yyyy 'at' h:mm a")
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn('min-w-0 cursor-default truncate whitespace-nowrap', className)}>
          {label} {relative(at)}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="px-2 py-1 leading-relaxed">
        {/* Every timestamp, so the compact footer (only "Updated") loses nothing. */}
        <div>Created {full(task.createdAt)}</div>
        <div>Updated {full(task.updatedAt)}</div>
        {task.completedAt !== null && <div>Completed {full(task.completedAt)}</div>}
      </TooltipContent>
    </Tooltip>
  )
}

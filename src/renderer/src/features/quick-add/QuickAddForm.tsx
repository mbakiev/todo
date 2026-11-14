// Quick-add form (spec §8), shared by the global popup window and the in-app NewTaskDialog.
// Title with live inline tokens (#tag !priority @date) shown as removable chips, an
// optional plain-text (Markdown) description, and a compact row of controls.
import { CalendarDays, CornerDownLeft, X } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { toast } from 'sonner'
import { MAX_TITLE_LENGTH, PRIORITY_LABELS, STATUS_LABELS } from '@shared/constants'
import { formatRelativeDate } from '@shared/dates'
import { parseQuickAdd } from '@shared/quickAddParser'
import type { LocalDate, Priority } from '@shared/types'
import {
  DatePickerField,
  PriorityIcon,
  PrioritySelect,
  TagChip,
  TagPicker,
} from '@/components/task'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { api } from '@/lib/api'
import { isMac, isModKey } from '@/lib/platform'
import { useToday } from '@/lib/useToday'
import { cn } from '@/lib/utils'
import { useSettings, useTagsById } from '@/stores/selectors'
import { useTasksStore } from '@/stores/tasksStore'
import type { NewTaskPrefill } from '@/stores/uiStore'
import {
  buildCreateInput,
  initialDraft,
  removeTagToken,
  removeTokens,
  resolveDraft,
  type QuickAddDraft,
} from './quickAddModel'

export interface QuickAddFormProps {
  /** Where the form is rendered; the popup window hides itself after saving. */
  variant: 'dialog' | 'window'
  /** Initial field values (e.g. due date from a calendar click). */
  prefill?: NewTaskPrefill
  /** Called after a task was created (not called for "create another"). */
  onCreated?(taskId: string): void
  /** Called when the user cancels (Esc). */
  onCancel?(): void
  autoFocus?: boolean
}

const NO_PREFILL: NewTaskPrefill = {}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-4 min-w-4 items-center justify-center rounded-[3px] border border-border bg-background px-1 font-sans text-[10px] leading-none text-muted-foreground">
      {children}
    </kbd>
  )
}

function Chip({
  children,
  onRemove,
  removeLabel,
  muted,
  title,
}: {
  children: ReactNode
  onRemove(): void
  removeLabel: string
  muted?: boolean
  title?: string
}) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex h-[18px] items-center gap-1 rounded-sm bg-muted px-1.5 text-[11px] font-medium text-foreground/80',
        muted && 'line-through opacity-50',
      )}
    >
      {children}
      <button
        type="button"
        aria-label={removeLabel}
        className="-mr-1 rounded-sm p-0.5 opacity-60 hover:opacity-100"
        onClick={onRemove}
      >
        <X className="size-3" />
      </button>
    </span>
  )
}

export function QuickAddForm({
  variant,
  prefill = NO_PREFILL,
  onCreated,
  onCancel,
  autoFocus = true,
}: QuickAddFormProps) {
  const [draft, setDraft] = useState<QuickAddDraft>(() => initialDraft(prefill))
  const [createMore, setCreateMore] = useState(false)
  const [saving, setSaving] = useState(false)
  const titleRef = useRef<HTMLInputElement>(null)
  const today = useToday()
  const { weekStartsOn } = useSettings()
  const tagsById = useTagsById()
  const mac = isMac()
  const isWindow = variant === 'window'

  const parsed = useMemo(
    () => parseQuickAdd(draft.text, { today, weekStartsOn }),
    [draft.text, today, weekStartsOn],
  )
  const findTag = useCallback(
    (name: string) => {
      const n = name.toLowerCase()
      return Object.values(tagsById).find((t) => t.name.toLowerCase() === n)
    },
    [tagsById],
  )
  const resolved = useMemo(
    () => resolveDraft(draft, parsed, prefill, findTag),
    [draft, parsed, prefill, findTag],
  )
  const update = (patch: Partial<QuickAddDraft>): void => setDraft((d) => ({ ...d, ...patch }))

  const focusTitle = useCallback(() => {
    const el = titleRef.current
    if (!el) return
    el.focus()
    const end = el.value.length
    el.setSelectionRange(end, end)
  }, [])

  // Popup: focus the title every time the window is shown (the draft is kept on blur).
  useEffect(() => {
    if (!isWindow) return
    return api().on.quickAddShown(() => requestAnimationFrame(focusTitle))
  }, [isWindow, focusTitle])

  const reset = (): void => setDraft(initialDraft(prefill))

  const submit = async (keepOpen: boolean): Promise<void> => {
    if (saving) return
    if (resolved.error) {
      if (resolved.title === '') focusTitle()
      else toast.error(resolved.error)
      return
    }
    setSaving(true)
    const task = await useTasksStore
      .getState()
      .create(buildCreateInput(resolved, draft.description))
    setSaving(false)
    if (!task) return // the store already showed an error toast
    reset()
    if (keepOpen) {
      toast.success('Task created', { description: task.title, duration: 2000 })
      requestAnimationFrame(focusTitle)
    } else {
      onCreated?.(task.id)
    }
  }

  const onRootKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Enter' && isModKey(e) && !e.altKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void submit(!isWindow && (e.shiftKey || createMore))
      return
    }
  }

  // Popup: Esc anywhere in the window hides it and clears the draft (the dialog's Esc is
  // handled by Radix). Radix popovers mark the Esc they consume as defaultPrevented (in a
  // document capture listener, i.e. before this one) — those only close themselves.
  const cancelRef = useRef<() => void>(() => {})
  useEffect(() => {
    cancelRef.current = () => {
      setDraft(initialDraft(prefill))
      onCancel?.()
    }
  })
  useEffect(() => {
    if (!isWindow) return
    const onKeyDown = (e: globalThis.KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing) return
      e.preventDefault()
      cancelRef.current()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isWindow])

  const onTitleKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter' && !isModKey(e) && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void submit(!isWindow && createMore)
    }
  }

  const setPriority = (p: Priority): void =>
    setDraft((d) => ({
      ...d,
      text: removeTokens(d.text, parsed, (t) => t.kind === 'priority'),
      explicitPriority: p,
    }))
  const setDue = (v: LocalDate | null): void =>
    setDraft((d) => ({
      ...d,
      text: removeTokens(d.text, parsed, (t) => t.kind === 'due'),
      explicitDue: v,
    }))

  const pickedOnly = draft.pickedTagIds
    .map((id) => tagsById[id])
    .filter((t) => t !== undefined)
    .filter((t) => !resolved.tokenTags.some((tt) => tt.tag?.id === t.id))
  const hasChips =
    parsed.priority !== null ||
    parsed.dueDate !== null ||
    resolved.tokenTags.length > 0 ||
    pickedOnly.length > 0

  const dueTone =
    resolved.dueDate && resolved.dueDate < today
      ? 'overdue'
      : resolved.dueDate === today
        ? 'today'
        : 'default'
  const enterLabel = mac ? '↩\uFE0E' : 'Enter'
  const modEnter = mac ? '⌘↩\uFE0E' : 'Ctrl+Enter'

  return (
    <div className="flex flex-col" onKeyDown={onRootKeyDown} data-testid="quick-add-form">
      <div className={cn('flex flex-col gap-1', isWindow ? 'px-4 pt-3.5' : 'px-4 pt-4')}>
        {!isWindow && (
          <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
            <span>New task</span>
            <span aria-hidden>·</span>
            <span>{STATUS_LABELS[resolved.status]}</span>
          </div>
        )}
        <input
          ref={titleRef}
          autoFocus={autoFocus}
          aria-label="Task title"
          placeholder="What needs doing?"
          maxLength={MAX_TITLE_LENGTH + 200}
          value={draft.text}
          onChange={(e) => update({ text: e.target.value })}
          onKeyDown={onTitleKeyDown}
          spellCheck
          className="h-8 w-full bg-transparent text-[15px] font-medium outline-none placeholder:font-normal placeholder:text-muted-foreground/70"
        />
        <textarea
          aria-label="Description"
          placeholder="Notes (optional, Markdown)"
          rows={1}
          value={draft.description}
          onChange={(e) => update({ description: e.target.value })}
          className="field-sizing-content max-h-40 min-h-5 w-full resize-none bg-transparent text-[13px] leading-5 text-foreground/90 outline-none placeholder:text-muted-foreground/60"
        />
        {hasChips && (
          <div className="flex flex-wrap items-center gap-1.5 pt-1" data-testid="quick-add-chips">
            {parsed.priority !== null && (
              <Chip
                removeLabel="Remove priority token"
                muted={resolved.overridden.priority}
                title={
                  resolved.overridden.priority ? 'Overridden by the priority picker' : undefined
                }
                onRemove={() =>
                  update({ text: removeTokens(draft.text, parsed, (t) => t.kind === 'priority') })
                }
              >
                <PriorityIcon priority={parsed.priority} className="size-3" />
                {PRIORITY_LABELS[parsed.priority]}
              </Chip>
            )}
            {parsed.dueDate !== null && (
              <Chip
                removeLabel="Remove due date token"
                muted={resolved.overridden.due}
                title={resolved.overridden.due ? 'Overridden by the due date picker' : undefined}
                onRemove={() =>
                  update({ text: removeTokens(draft.text, parsed, (t) => t.kind === 'due') })
                }
              >
                <CalendarDays className="size-3" />
                {formatRelativeDate(parsed.dueDate, today)}
              </Chip>
            )}
            {resolved.tokenTags.map(({ name, tag }) => (
              <span key={name.toLowerCase()} title={tag ? undefined : 'New tag — created on save'}>
                <TagChip
                  tag={{ name, color: tag?.color ?? 'slate' }}
                  className={cn(!tag && 'outline-1 outline-muted-foreground/40 outline-dashed')}
                  onRemove={() => update({ text: removeTagToken(draft.text, parsed, name) })}
                />
              </span>
            ))}
            {pickedOnly.map((t) => (
              <TagChip
                key={t.id}
                tag={t}
                onRemove={() =>
                  update({ pickedTagIds: draft.pickedTagIds.filter((id) => id !== t.id) })
                }
              />
            ))}
          </div>
        )}
      </div>

      <div className={cn('flex items-center gap-0.5 px-2.5', isWindow ? 'pt-2 pb-2' : 'pt-3 pb-2')}>
        <PrioritySelect value={resolved.priority} onChange={setPriority} />
        <DatePickerField
          value={resolved.dueDate}
          onChange={setDue}
          placeholder="Due date"
          tone={dueTone}
          min={resolved.startDate}
        />
        {!isWindow && (
          <DatePickerField
            value={resolved.startDate}
            onChange={(v) => update({ explicitStart: v })}
            placeholder="Start date"
            max={resolved.dueDate}
          />
        )}
        <TagPicker value={draft.pickedTagIds} onChange={(ids) => update({ pickedTagIds: ids })} />
        <div className="flex-1" />
        {isWindow ? (
          <Button
            size="sm"
            className="h-7 gap-1.5 px-2.5 text-[13px]"
            disabled={saving || resolved.title === ''}
            onClick={() => void submit(false)}
          >
            Add task
            <CornerDownLeft className="size-3.5 opacity-70" />
          </Button>
        ) : (
          <>
            <label className="mr-2 flex items-center gap-1.5 text-[12px] text-muted-foreground">
              <Switch size="sm" checked={createMore} onCheckedChange={setCreateMore} />
              Create more
            </label>
            <Button
              size="sm"
              className="h-7 px-3 text-[13px]"
              disabled={saving || resolved.title === ''}
              onClick={() => void submit(createMore)}
            >
              Create task
            </Button>
          </>
        )}
      </div>

      <div className="flex items-center gap-3 border-t bg-muted/40 px-4 py-1.5 text-[11px] text-muted-foreground">
        <span className="truncate">
          Inline: <span className="font-mono text-foreground/70">#tag</span>{' '}
          <span className="font-mono text-foreground/70">!high</span>{' '}
          <span className="font-mono text-foreground/70">@fri</span>
        </span>
        <span className="flex-1" />
        <span className="flex items-center gap-1">
          <Kbd>{enterLabel}</Kbd> save
        </span>
        {isWindow ? (
          <>
            <span className="flex items-center gap-1">
              <Kbd>Tab</Kbd> notes
            </span>
            <span className="flex items-center gap-1">
              <Kbd>Esc</Kbd> close
            </span>
          </>
        ) : (
          <>
            <span className="flex items-center gap-1">
              <Kbd>{modEnter}</Kbd> save from notes
            </span>
            <span className="flex items-center gap-1">
              <Kbd>{mac ? '⌘⇧↩\uFE0E' : 'Ctrl+Shift+Enter'}</Kbd> save &amp; new
            </span>
          </>
        )}
      </div>
    </div>
  )
}

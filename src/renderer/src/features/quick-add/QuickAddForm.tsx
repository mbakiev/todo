// PLACEHOLDER — owned by the desktop-shell/quick-add feature. Replace this file's contents
// (keep the export name and props). Spec §8. Used by the popup window AND NewTaskDialog.
import { useMemo, useState } from 'react'
import { parseQuickAdd } from '@shared/quickAddParser'
import { PriorityBadge, TagChip } from '@/components/task'
import { Input } from '@/components/ui/input'
import { useToday } from '@/lib/useToday'
import { useSettings } from '@/stores/selectors'
import { useTagsStore } from '@/stores/tagsStore'
import { useTasksStore } from '@/stores/tasksStore'
import type { NewTaskPrefill } from '@/stores/uiStore'

export interface QuickAddFormProps {
  /** Where the form is rendered; the popup window hides itself after saving. */
  variant: 'dialog' | 'window'
  /** Initial field values (e.g. due date from a calendar click). */
  prefill?: NewTaskPrefill
  /** Called after a task was created. */
  onCreated?(taskId: string): void
  /** Called when the user cancels (Esc). */
  onCancel?(): void
  autoFocus?: boolean
}

export function QuickAddForm({
  prefill,
  onCreated,
  onCancel,
  autoFocus = true,
}: QuickAddFormProps) {
  const [text, setText] = useState('')
  const today = useToday()
  const { weekStartsOn } = useSettings()
  const parsed = useMemo(
    () => parseQuickAdd(text, { today, weekStartsOn }),
    [text, today, weekStartsOn],
  )

  const submit = async (): Promise<void> => {
    if (!parsed.title) return
    const existing = parsed.tagNames.map((n) => useTagsStore.getState().findByName(n))
    const tagIds = [
      ...(prefill?.tagIds ?? []),
      ...existing.filter((t) => t !== undefined).map((t) => t.id),
    ]
    const newTagNames = parsed.tagNames.filter((_, i) => existing[i] === undefined)
    const task = await useTasksStore.getState().create({
      title: parsed.title,
      status: 'not_started',
      priority: parsed.priority ?? prefill?.priority ?? 2,
      dueDate: parsed.dueDate ?? prefill?.dueDate ?? null,
      startDate: prefill?.startDate ?? null,
      tagIds,
      newTagNames,
    })
    if (task) {
      setText('')
      onCreated?.(task.id)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Input
        autoFocus={autoFocus}
        aria-label="Task title"
        placeholder="Task title  —  #tag  !high  @tomorrow"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            e.preventDefault()
            void submit()
          } else if (e.key === 'Escape') {
            onCancel?.()
          }
        }}
        className="h-9 text-sm"
      />
      {parsed.tokens.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          {parsed.priority && <PriorityBadge priority={parsed.priority} />}
          {parsed.dueDate && <span>Due {parsed.dueDate}</span>}
          {parsed.tagNames.map((n) => (
            <TagChip
              key={n}
              tag={{ name: n, color: useTagsStore.getState().findByName(n)?.color ?? 'slate' }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

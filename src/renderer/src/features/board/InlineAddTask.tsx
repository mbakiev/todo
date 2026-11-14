// "+ Add task" at the top of Not Started: title only, Enter adds and stays open for the
// next one, Esc / blur closes. Inline tokens (#tag !high @fri) are parsed on submit.
import { Plus } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import type { BoardScope } from '@shared/types'
import { filterBoard, matchesFilter } from '@shared/views'
import { getToday } from '@/lib/useToday'
import { cn } from '@/lib/utils'
import { useSettingsStore } from '@/stores/settingsStore'
import { useTagsStore } from '@/stores/tagsStore'
import { useTasksStore } from '@/stores/tasksStore'
import { useUiStore } from '@/stores/uiStore'
import { buildInlineCreateInput, inlineAddError } from './inlineAdd'

export function InlineAddTask({ scope }: { scope: BoardScope }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const weekStartsOn = useSettingsStore((st) => st.settings.weekStartsOn)
  // Over-long titles are flagged here and never sent (Enter does nothing meanwhile).
  const error = open ? inlineAddError(text, { today: getToday(), weekStartsOn }) : null

  const submit = (): void => {
    if (error) return
    const today = getToday()
    const settings = useSettingsStore.getState().settings
    const input = buildInlineCreateInput(text, {
      today,
      weekStartsOn: settings.weekStartsOn,
      findTagByName: (n) => useTagsStore.getState().findByName(n),
    })
    if (!input) return
    setText('')
    void useTasksStore
      .getState()
      .create(input)
      .then((task) => {
        if (!task) return
        // A due date beyond this board, or the active filter, can hide the new card.
        const onBoard = filterBoard(scope, [task], getToday(), settings).length > 0
        const matches = matchesFilter(task, useUiStore.getState().filter)
        if (!onBoard || !matches) {
          toast.success(`Added “${task.title}”`, {
            description: !onBoard
              ? 'It is scheduled later, so this board hides it.'
              : 'Hidden by the current filter.',
            action: { label: 'Open', onClick: () => useUiStore.getState().selectTask(task.id) },
          })
        }
      })
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setOpen(true)
          // Focus after the input mounts.
          requestAnimationFrame(() => inputRef.current?.focus())
        }}
        className={cn(
          'flex h-8 w-full items-center gap-1.5 rounded-md px-2 text-[13px] text-muted-foreground',
          'outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50',
        )}
      >
        <Plus className="size-3.5" />
        Add task
      </button>
    )
  }

  // The 1 px border + 30 px input match the closed button's 32 px, so nothing below moves.
  return (
    // data-no-deselect: clicks in the form (its border, the error line) never close the panel.
    <div
      className="rounded-md border border-primary/50 bg-card shadow-xs ring-1 ring-primary/30"
      data-no-deselect
    >
      <input
        ref={inputRef}
        autoFocus
        aria-label="New task title"
        placeholder="Task title  —  #tag  !high  @fri"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            e.preventDefault()
            submit()
          } else if (e.key === 'Escape') {
            // Don't let the shell's Esc handler also close the detail panel.
            e.stopPropagation()
            setText('')
            setOpen(false)
          }
        }}
        onBlur={() => setOpen(false)}
        aria-invalid={error !== null || undefined}
        className="h-7.5 w-full bg-transparent px-2.5 text-[13px] outline-none placeholder:text-muted-foreground/70"
      />
      {error && (
        <p role="alert" className="px-2.5 pb-1.5 text-[12px] text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}

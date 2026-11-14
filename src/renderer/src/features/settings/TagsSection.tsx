import { Check, Plus, Trash2 } from 'lucide-react'
import { useMemo, useState, type FormEvent } from 'react'
import { MAX_TAG_NAME_LENGTH, TAG_COLOR_LABELS, TAG_COLORS } from '@shared/constants'
import type { Tag, TagColor } from '@shared/types'
import { TAG_DOT_CLASS } from '@/components/task'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { useTags, useTasks } from '@/stores/selectors'
import { useTagsStore } from '@/stores/tagsStore'
import { SectionHeading } from './parts'

function ColorPicker({ tag }: { tag: Tag }) {
  const update = useTagsStore((s) => s.update)
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Colour of ${tag.name}: ${TAG_COLOR_LABELS[tag.color]}`}
          className="flex size-6 items-center justify-center rounded-md outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <span className={cn('size-3 rounded-full', TAG_DOT_CLASS[tag.color])} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-2">
        <div className="grid grid-cols-4 gap-1.5" role="listbox" aria-label="Tag colour">
          {TAG_COLORS.map((c: TagColor) => (
            <button
              key={c}
              type="button"
              role="option"
              aria-selected={c === tag.color}
              title={TAG_COLOR_LABELS[c]}
              aria-label={TAG_COLOR_LABELS[c]}
              onClick={() => {
                setOpen(false)
                if (c !== tag.color) void update(tag.id, { color: c })
              }}
              className="flex size-7 items-center justify-center rounded-md outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <span
                className={cn(
                  'flex size-4 items-center justify-center rounded-full',
                  TAG_DOT_CLASS[c],
                )}
              >
                {c === tag.color && <Check className="size-3 text-white" strokeWidth={3} />}
              </span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function TagName({ tag }: { tag: Tag }) {
  const update = useTagsStore((s) => s.update)
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(tag.name)

  const commit = (): void => {
    setEditing(false)
    const name = value.trim()
    if (name && name !== tag.name) void update(tag.id, { name })
    else setValue(tag.name)
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setValue(tag.name)
          setEditing(true)
        }}
        title="Rename"
        aria-label={`Rename ${tag.name}`}
        className="min-w-0 flex-1 truncate rounded px-1.5 py-0.5 text-left text-[13px] outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        {tag.name}
      </button>
    )
  }
  return (
    <Input
      autoFocus
      aria-label={`New name for ${tag.name}`}
      value={value}
      maxLength={MAX_TAG_NAME_LENGTH}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          commit()
        } else if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          setValue(tag.name)
          setEditing(false)
        }
      }}
      className="h-7 flex-1 px-1.5 text-[13px] shadow-none"
    />
  )
}

function DeleteTagDialog({
  tag,
  count,
  onClose,
}: {
  tag: Tag | null
  count: number
  onClose(): void
}) {
  const remove = useTagsStore((s) => s.remove)
  return (
    <Dialog open={tag !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="text-sm">Delete tag “{tag?.name}”?</DialogTitle>
          <DialogDescription className="text-xs">
            {count === 0
              ? 'No tasks use this tag.'
              : `${count} ${count === 1 ? 'task uses' : 'tasks use'} this tag. The tasks are kept; only the tag is removed from them.`}{' '}
            This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => {
              if (tag) void remove(tag.id)
              onClose()
            }}
          >
            Delete tag
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function TagsSection() {
  const tags = useTags()
  const tasks = useTasks()
  const create = useTagsStore((s) => s.create)
  const findByName = useTagsStore((s) => s.findByName)
  const [newName, setNewName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<Tag | null>(null)

  const counts = useMemo(() => {
    const m = new Map<string, number>()
    for (const t of tasks) for (const id of t.tagIds) m.set(id, (m.get(id) ?? 0) + 1)
    return m
  }, [tasks])

  const onCreate = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    const name = newName.trim().replace(/^#/, '')
    if (!name) return
    if (findByName(name)) {
      setError(`A tag named “${name}” already exists`)
      return
    }
    const tag = await create(name)
    if (tag) {
      setNewName('')
      setError(null)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <SectionHeading
        title="Tags"
        description="Click a name to rename it, the dot to change its colour. New tags can also be created by typing #name when adding a task."
      />
      <form onSubmit={(e) => void onCreate(e)} className="flex items-center gap-2">
        <Input
          aria-label="New tag name"
          placeholder="New tag name"
          value={newName}
          maxLength={MAX_TAG_NAME_LENGTH}
          onChange={(e) => {
            setNewName(e.target.value)
            setError(null)
          }}
          className="h-8 flex-1 text-[13px]"
        />
        <Button
          type="submit"
          size="sm"
          variant="outline"
          disabled={!newName.trim()}
          className="h-8"
        >
          <Plus className="size-3.5" />
          Add tag
        </Button>
      </form>
      {error && <p className="-mt-1 text-xs text-destructive">{error}</p>}

      {tags.length === 0 ? (
        <p className="py-6 text-center text-xs text-muted-foreground">No tags yet.</p>
      ) : (
        <ul className="divide-y rounded-md border" data-testid="tags-list">
          {tags.map((tag) => {
            const n = counts.get(tag.id) ?? 0
            return (
              <li key={tag.id} className="flex h-10 items-center gap-1.5 px-2" data-tag-id={tag.id}>
                <ColorPicker tag={tag} />
                <TagName key={tag.name} tag={tag} />
                <span className="w-16 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                  {n} {n === 1 ? 'task' : 'tasks'}
                </span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="size-7 text-muted-foreground hover:text-destructive"
                  aria-label={`Delete ${tag.name}`}
                  onClick={() => setDeleting(tag)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </li>
            )
          })}
        </ul>
      )}
      <DeleteTagDialog
        tag={deleting}
        count={deleting ? (counts.get(deleting.id) ?? 0) : 0}
        onClose={() => setDeleting(null)}
      />
    </div>
  )
}

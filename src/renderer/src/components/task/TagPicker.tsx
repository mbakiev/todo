// Tag combobox: search existing tags, toggle them, or create a new one by typing.
import { Check, Plus, Tag as TagIcon } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { MAX_TAG_NAME_LENGTH } from '@shared/constants'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useTags } from '@/stores/selectors'
import { useTagsStore } from '@/stores/tagsStore'
import { TAG_DOT_CLASS } from './tagColors'

export interface TagPickerProps {
  /** Selected tag ids. */
  value: readonly string[]
  onChange(tagIds: string[]): void
  /** Custom trigger element; defaults to a small "Tags" button. */
  trigger?: ReactNode
  /** Allow creating tags from the search text (default true). */
  allowCreate?: boolean
  align?: 'start' | 'center' | 'end'
  open?: boolean
  onOpenChange?(open: boolean): void
}

export function TagPicker({
  value,
  onChange,
  trigger,
  allowCreate = true,
  align = 'start',
  open,
  onOpenChange,
}: TagPickerProps) {
  const tags = useTags()
  const createTag = useTagsStore((s) => s.create)
  const [query, setQuery] = useState('')
  const [innerOpen, setInnerOpen] = useState(false)
  const isOpen = open ?? innerOpen
  const setOpen = (o: boolean): void => {
    if (!o) setQuery('')
    onOpenChange?.(o)
    setInnerOpen(o)
  }

  const trimmed = query.trim().replace(/^#/, '').slice(0, MAX_TAG_NAME_LENGTH)
  const exact = tags.some((t) => t.name.toLowerCase() === trimmed.toLowerCase())
  const toggle = (id: string): void =>
    onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id])

  const create = async (): Promise<void> => {
    if (!trimmed) return
    const tag = await createTag(trimmed)
    if (tag) onChange([...value, tag.id])
    setQuery('')
  }

  return (
    <Popover open={isOpen} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {trigger ?? (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 px-2 text-[13px] font-normal text-muted-foreground"
          >
            <TagIcon className="size-3.5" />
            Tags
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent align={align} className="w-60 p-0">
        <Command loop>
          <CommandInput
            placeholder="Search or create tag…"
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            <CommandEmpty className="py-3 text-center text-xs text-muted-foreground">
              {allowCreate ? 'Type to create a tag' : 'No tags'}
            </CommandEmpty>
            {tags.length > 0 && (
              <CommandGroup>
                {tags.map((t) => (
                  <CommandItem key={t.id} value={t.name} onSelect={() => toggle(t.id)}>
                    <span className={cn('size-2 rounded-full', TAG_DOT_CLASS[t.color])} />
                    <span className="flex-1 truncate">{t.name}</span>
                    {value.includes(t.id) && <Check className="size-3.5 text-muted-foreground" />}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {allowCreate && trimmed !== '' && !exact && (
              <CommandGroup forceMount>
                <CommandItem
                  forceMount
                  value={`__create__${trimmed}`}
                  onSelect={() => void create()}
                >
                  <Plus className="size-3.5" />
                  <span className="truncate">
                    Create “<span className="font-medium">{trimmed}</span>”
                  </span>
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

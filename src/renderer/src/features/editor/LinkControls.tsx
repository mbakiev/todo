// Link editing (Cmd/Ctrl+K popover) and the small bubble shown while the cursor is in a link.
import type { Editor } from '@tiptap/core'
import { BubbleMenu } from '@tiptap/react/menus'
import { ExternalLink, Pencil, Unlink } from 'lucide-react'
import { useMemo, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { normalizeHref } from './linkHref'

function selectionRect(editor: Editor): DOMRect {
  const { from, to } = editor.state.selection
  try {
    const a = editor.view.coordsAtPos(from)
    const b = editor.view.coordsAtPos(to)
    return new DOMRect(a.left, a.top, Math.max(1, b.right - a.left), a.bottom - a.top)
  } catch {
    return editor.view.dom.getBoundingClientRect()
  }
}

export interface LinkPopoverProps {
  editor: Editor
  open: boolean
  onOpenChange(open: boolean): void
}

export function LinkPopover({ editor, open, onOpenChange }: LinkPopoverProps) {
  if (!open) return null
  return <LinkPopoverOpen editor={editor} onOpenChange={onOpenChange} />
}

function LinkPopoverOpen({ editor, onOpenChange }: Omit<LinkPopoverProps, 'open'>) {
  // Snapshot on open: the selection and current href.
  const initialHref = useMemo(() => String(editor.getAttributes('link')['href'] ?? ''), [editor])
  const anchor = useMemo(() => {
    const rect = selectionRect(editor)
    return { current: { getBoundingClientRect: () => rect } }
  }, [editor])
  const [href, setHref] = useState(initialHref)

  const close = (): void => {
    onOpenChange(false)
    editor.commands.focus()
  }
  const apply = (e: FormEvent): void => {
    e.preventDefault()
    const url = normalizeHref(href)
    const chain = editor.chain().focus().extendMarkRange('link')
    if (!url) {
      chain.unsetLink().run()
    } else if (editor.state.selection.empty && !editor.isActive('link')) {
      // Nothing selected: insert the URL itself as the link text.
      chain
        .insertContent({ type: 'text', text: url, marks: [{ type: 'link', attrs: { href: url } }] })
        .run()
    } else {
      chain.setLink({ href: url }).run()
    }
    onOpenChange(false)
  }

  return (
    <Popover open onOpenChange={(o) => (o ? undefined : close())}>
      <PopoverAnchor virtualRef={anchor} />
      <PopoverContent
        align="start"
        side="bottom"
        className="w-80 p-2"
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          const input = (e.currentTarget as HTMLElement).querySelector('input')
          input?.focus()
          input?.select()
        }}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <form className="flex items-center gap-1.5" onSubmit={apply}>
          <Input
            value={href}
            onChange={(e) => setHref(e.target.value)}
            placeholder="Paste or type a link…"
            aria-label="Link URL"
            className="h-7 text-[13px]"
          />
          <Button type="submit" size="sm" className="h-7 px-2.5 text-xs">
            {initialHref ? 'Update' : 'Add'}
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  )
}

export interface LinkBubbleProps {
  editor: Editor
  onEdit(): void
  onOpen(href: string): void
}

export function LinkBubble({ editor, onEdit, onOpen }: LinkBubbleProps) {
  const [href, setHref] = useState('')
  return (
    <BubbleMenu
      editor={editor}
      pluginKey="linkBubble"
      options={{ placement: 'bottom-start', offset: 6 }}
      shouldShow={({ editor: e }) => {
        const show = e.isFocused && e.isActive('link') && e.state.selection.empty
        if (show) setHref(String(e.getAttributes('link')['href'] ?? ''))
        return show
      }}
      className="z-30 flex max-w-80 items-center gap-0.5 rounded-md border bg-popover p-0.5 text-[12px] text-popover-foreground shadow-md"
    >
      <button
        type="button"
        className="flex min-w-0 items-center gap-1.5 rounded px-1.5 py-1 text-primary hover:bg-accent"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => href && onOpen(href)}
        title="Open in browser"
      >
        <ExternalLink className="size-3 shrink-0" />
        <span className="truncate">{href}</span>
      </button>
      <span className="mx-0.5 h-3.5 w-px shrink-0 bg-border" />
      <button
        type="button"
        aria-label="Edit link"
        title="Edit link"
        className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onEdit}
      >
        <Pencil className="size-3" />
      </button>
      <button
        type="button"
        aria-label="Remove link"
        title="Remove link"
        className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => editor.chain().focus().extendMarkRange('link').unsetLink().run()}
      >
        <Unlink className="size-3" />
      </button>
    </BubbleMenu>
  )
}

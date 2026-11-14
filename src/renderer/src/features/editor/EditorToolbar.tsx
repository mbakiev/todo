// Compact formatting toolbar (spec §7): marks, headings, lists, quote, code block, link, table
// (+ contextual row/column controls while the cursor is inside a table).
import type { Editor } from '@tiptap/core'
import { useEditorState } from '@tiptap/react'
import {
  Bold,
  ChevronDown,
  Code,
  CodeXml,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link,
  List,
  ListOrdered,
  ListTodo,
  Strikethrough,
  Table,
  TextQuote,
} from 'lucide-react'
import type { ReactNode } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { shortcutLabel } from './shortcutLabel'

interface ToolButtonProps {
  label: string
  shortcut?: string
  active?: boolean
  disabled?: boolean
  onClick(): void
  children: ReactNode
}

function ToolButton({ label, shortcut, active, disabled, onClick, children }: ToolButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={active}
          disabled={disabled}
          // Keep the editor selection: don't steal focus on mousedown.
          onMouseDown={(e) => e.preventDefault()}
          onClick={onClick}
          className={cn(
            'inline-flex size-6 shrink-0 items-center justify-center rounded-[5px] text-muted-foreground transition-colors',
            'hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40',
            'focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
            '[&_svg]:size-3.5',
            active && 'bg-accent text-foreground',
          )}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={4} className="px-2 py-1">
        {label}
        {shortcut && <span className="ml-1.5 opacity-60">{shortcutLabel(shortcut)}</span>}
      </TooltipContent>
    </Tooltip>
  )
}

const Divider = () => <span className="mx-1 h-3.5 w-px shrink-0 bg-border" aria-hidden />

export interface EditorToolbarProps {
  editor: Editor
  onEditLink(): void
  className?: string
}

export function EditorToolbar({ editor, onEditLink, className }: EditorToolbarProps) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      strike: e.isActive('strike'),
      code: e.isActive('code'),
      h1: e.isActive('heading', { level: 1 }),
      h2: e.isActive('heading', { level: 2 }),
      h3: e.isActive('heading', { level: 3 }),
      bulletList: e.isActive('bulletList'),
      orderedList: e.isActive('orderedList'),
      taskList: e.isActive('taskList'),
      blockquote: e.isActive('blockquote'),
      codeBlock: e.isActive('codeBlock'),
      link: e.isActive('link'),
      table: e.isActive('table'),
      headerRow: isHeaderRow(e),
    }),
  })
  const chain = () => editor.chain().focus()

  return (
    <div
      role="toolbar"
      aria-label="Formatting"
      className={cn('flex flex-wrap items-center gap-0.5', className)}
    >
      <ToolButton
        label="Bold"
        shortcut="Mod-b"
        active={s.bold}
        onClick={() => chain().toggleBold().run()}
      >
        <Bold />
      </ToolButton>
      <ToolButton
        label="Italic"
        shortcut="Mod-i"
        active={s.italic}
        onClick={() => chain().toggleItalic().run()}
      >
        <Italic />
      </ToolButton>
      <ToolButton
        label="Strikethrough"
        shortcut="Mod-Shift-s"
        active={s.strike}
        onClick={() => chain().toggleStrike().run()}
      >
        <Strikethrough />
      </ToolButton>
      <ToolButton
        label="Inline code"
        shortcut="Mod-e"
        active={s.code}
        onClick={() => chain().toggleCode().run()}
      >
        <Code />
      </ToolButton>
      <Divider />
      <ToolButton
        label="Heading 1"
        shortcut="Mod-Alt-1"
        active={s.h1}
        onClick={() => chain().toggleHeading({ level: 1 }).run()}
      >
        <Heading1 />
      </ToolButton>
      <ToolButton
        label="Heading 2"
        shortcut="Mod-Alt-2"
        active={s.h2}
        onClick={() => chain().toggleHeading({ level: 2 }).run()}
      >
        <Heading2 />
      </ToolButton>
      <ToolButton
        label="Heading 3"
        shortcut="Mod-Alt-3"
        active={s.h3}
        onClick={() => chain().toggleHeading({ level: 3 }).run()}
      >
        <Heading3 />
      </ToolButton>
      <Divider />
      <ToolButton
        label="Bulleted list"
        shortcut="Mod-Shift-8"
        active={s.bulletList}
        onClick={() => chain().toggleBulletList().run()}
      >
        <List />
      </ToolButton>
      <ToolButton
        label="Numbered list"
        shortcut="Mod-Shift-7"
        active={s.orderedList}
        onClick={() => chain().toggleOrderedList().run()}
      >
        <ListOrdered />
      </ToolButton>
      <ToolButton
        label="Checklist"
        shortcut="Mod-Shift-9"
        active={s.taskList}
        onClick={() => chain().toggleTaskList().run()}
      >
        <ListTodo />
      </ToolButton>
      <Divider />
      <ToolButton
        label="Quote"
        shortcut="Mod-Shift-b"
        active={s.blockquote}
        onClick={() => chain().toggleBlockquote().run()}
      >
        <TextQuote />
      </ToolButton>
      <ToolButton
        label="Code block"
        shortcut="Mod-Alt-c"
        active={s.codeBlock}
        onClick={() => chain().toggleCodeBlock().run()}
      >
        <CodeXml />
      </ToolButton>
      <ToolButton label="Link" shortcut="Mod-k" active={s.link} onClick={onEditLink}>
        <Link />
      </ToolButton>
      {s.table ? (
        <TableMenu editor={editor} headerRow={s.headerRow} />
      ) : (
        <ToolButton
          label="Insert table"
          disabled={s.codeBlock}
          onClick={() => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
        >
          <Table />
        </ToolButton>
      )}
    </div>
  )
}

function isHeaderRow(editor: Editor): boolean {
  const { $from } = editor.state.selection
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d)
    if (node.type.name === 'table') {
      const first = node.firstChild?.firstChild
      return first?.type.name === 'tableHeader'
    }
  }
  return false
}

function TableMenu({ editor, headerRow }: { editor: Editor; headerRow: boolean }) {
  const run = (fn: (c: ReturnType<Editor['chain']>) => ReturnType<Editor['chain']>) => () =>
    fn(editor.chain().focus()).run()
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Table options"
              onMouseDown={(e) => e.preventDefault()}
              className="inline-flex h-6 shrink-0 items-center gap-0.5 rounded-[5px] bg-accent px-1 text-foreground transition-colors hover:bg-accent/80 [&_svg]:size-3.5"
            >
              <Table />
              <ChevronDown className="size-3! opacity-60" />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={4} className="px-2 py-1">
          Table options
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        align="start"
        className="w-48 text-[13px]"
        // Return focus to the editor, not the trigger.
        onCloseAutoFocus={(e) => {
          e.preventDefault()
          editor.commands.focus()
        }}
      >
        <DropdownMenuItem onSelect={run((c) => c.addRowBefore())}>
          Insert row above
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={run((c) => c.addRowAfter())}>Insert row below</DropdownMenuItem>
        <DropdownMenuItem onSelect={run((c) => c.addColumnBefore())}>
          Insert column left
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={run((c) => c.addColumnAfter())}>
          Insert column right
        </DropdownMenuItem>
        {/* GFM tables always have a header row, so it can be added but not removed. */}
        {!headerRow && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={run((c) => c.toggleHeaderRow())}>
              Make first row a header
            </DropdownMenuItem>
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={run((c) => c.deleteRow())}>Delete row</DropdownMenuItem>
        <DropdownMenuItem onSelect={run((c) => c.deleteColumn())}>Delete column</DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onSelect={run((c) => c.deleteTable())}>
          Delete table
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

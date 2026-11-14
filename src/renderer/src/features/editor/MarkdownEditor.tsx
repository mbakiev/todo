// Tiptap rich-text editor whose value is Markdown (GFM) — spec §7 "Description editor".
import { EditorContent, useEditor } from '@tiptap/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { isModKey } from '@/lib/platform'
import { EditorToolbar } from './EditorToolbar'
import { LinkBubble, LinkPopover } from './LinkControls'
import { createExtensions } from './markdown/extensions'
import { editorMarkdown, normalizeMarkdown } from './markdown/normalize'
import './editor.css'

export interface MarkdownEditorProps {
  /** Markdown source. */
  value: string
  /** Called with the new Markdown. Callers debounce/flush; the editor reports every change. */
  onChange(markdown: string): void
  placeholder?: string
  /** Called when the editor loses focus (flush point for autosave). */
  onBlur?(): void
  className?: string
}

/** Opens a link in the OS browser (the main process routes window.open to shell.openExternal). */
function openExternal(href: string): void {
  window.open(href, '_blank', 'noopener,noreferrer')
}

export function MarkdownEditor({
  value,
  onChange,
  placeholder = 'Add a description…',
  onBlur,
  className,
}: MarkdownEditorProps) {
  // Latest callbacks without re-creating the editor.
  const onChangeRef = useRef(onChange)
  const onBlurRef = useRef(onBlur)
  useEffect(() => {
    onChangeRef.current = onChange
    onBlurRef.current = onBlur
  })
  // `value` as last loaded into the editor, the editor's canonical serialisation of it, and the
  // last string reported through onChange. Re-serialising never counts as an edit: opening a
  // task must not rewrite its description just because the serialiser formats it differently.
  const sync = useRef({ loaded: value, canonical: normalizeMarkdown(value), emitted: value })
  const [linkOpen, setLinkOpen] = useState(false)
  const openLinkRef = useRef<() => void>(() => undefined)

  const extensions = useMemo(() => createExtensions({ placeholder }), [placeholder])
  const editor = useEditor({
    extensions,
    content: value,
    contentType: 'markdown',
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: {
        class: 'md-content',
        'aria-label': 'Description',
        'aria-multiline': 'true',
        role: 'textbox',
        spellcheck: 'true',
      },
      handleKeyDown: (view, event) => {
        if (event.key === 'Escape') {
          // First Esc leaves the editor; the panel only closes on the next one.
          view.dom.blur()
          return true
        }
        if (
          isModKey(event) &&
          !event.altKey &&
          !event.shiftKey &&
          event.key.toLowerCase() === 'k'
        ) {
          openLinkRef.current()
          return true
        }
        return false
      },
      handleClick: (_view, _pos, event) => {
        if (!isModKey(event)) return false
        const anchor = (event.target as HTMLElement | null)?.closest('a[href]')
        const href = anchor?.getAttribute('href')
        if (!href) return false
        event.preventDefault()
        openExternal(href)
        return true
      },
      handleDOMEvents: {
        // Never let a plain click on a link navigate the app window.
        click: (_view, event) => {
          if ((event.target as HTMLElement | null)?.closest('a[href]')) event.preventDefault()
          return false
        },
      },
    },
    onCreate: ({ editor: e }) => {
      sync.current.canonical = editorMarkdown(e)
    },
    onUpdate: ({ editor: e }) => {
      const md = editorMarkdown(e)
      const s = sync.current
      const out = md === s.canonical ? s.loaded : md
      if (out === s.emitted) return
      s.emitted = out
      onChangeRef.current(out)
    },
    onBlur: () => onBlurRef.current?.(),
  })

  useEffect(() => {
    openLinkRef.current = () => setLinkOpen(true)
  }, [])

  // Adopt external value changes (another window, task switch) — but never echo our own
  // output back into the editor, which would reset the cursor mid-typing.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    const s = sync.current
    if (value === s.emitted) return
    s.emitted = value
    s.loaded = value
    if (normalizeMarkdown(value) === editorMarkdown(editor)) {
      s.canonical = normalizeMarkdown(value)
      return
    }
    const { from, to } = editor.state.selection
    editor
      .chain()
      .command(({ tr }) => {
        tr.setMeta('addToHistory', false)
        return true
      })
      .setContent(value, { contentType: 'markdown', emitUpdate: false })
      .run()
    s.canonical = editorMarkdown(editor)
    const max = editor.state.doc.content.size
    editor.commands.setTextSelection({ from: Math.min(from, max), to: Math.min(to, max) })
  }, [value, editor])

  return (
    <div className={cn('md-editor flex min-h-0 flex-col', className)} data-testid="markdown-editor">
      <div className="md-toolbar sticky top-0 z-10 -mx-1 bg-background px-1 pb-1.5">
        <EditorToolbar editor={editor} onEditLink={() => setLinkOpen(true)} />
        <LinkPopover editor={editor} open={linkOpen} onOpenChange={setLinkOpen} />
      </div>
      <EditorContent
        editor={editor}
        className="flex min-h-24 flex-1 cursor-text flex-col"
        onMouseDown={(e) => {
          // Clicking the empty area below the content focuses the end of the document.
          if (e.target === e.currentTarget) {
            e.preventDefault()
            editor.commands.focus('end')
          }
        }}
      />
      <LinkBubble editor={editor} onEdit={() => setLinkOpen(true)} onOpen={openExternal} />
    </div>
  )
}

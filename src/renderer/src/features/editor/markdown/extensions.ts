// The editor's schema. Shared by the React editor and the headless Markdown helpers/tests so
// parsing and serialisation are always exercised with exactly the same extension set.
import type { AnyExtension } from '@tiptap/core'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import Placeholder from '@tiptap/extension-placeholder'
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table'
import { Markdown } from '@tiptap/markdown'
import StarterKit from '@tiptap/starter-kit'
import { MarkdownClipboard } from './clipboard'
import { installMarkdownEscapePatch } from './patchSerializer'
import { HtmlEntity, RawBlock, RawInline } from './rawMarkdown'

installMarkdownEscapePatch()

/** The stock table serialiser pads its output with newlines, leaving triple blank lines. */
const MarkdownTable = Table.extend({
  renderMarkdown(node, helpers, context) {
    const out = this.parent?.(node, helpers, context) ?? ''
    return out.replace(/^\n+|\n+$/g, '')
  },
})

export interface EditorExtensionOptions {
  placeholder?: string
}

export function createExtensions({ placeholder }: EditorExtensionOptions = {}): AnyExtension[] {
  const extensions: AnyExtension[] = [
    StarterKit.configure({
      // Underline has no GFM syntax; keep the schema Markdown-representable.
      underline: false,
      link: {
        // Clicks are handled by MarkdownEditor (Mod+click opens externally).
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        defaultProtocol: 'https',
        HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer nofollow' },
      },
    }),
    MarkdownTable.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
    TaskList,
    TaskItem.configure({ nested: true }),
    RawInline,
    RawBlock,
    HtmlEntity,
    Markdown.configure({ indentation: { style: 'space', size: 2 } }),
    MarkdownClipboard,
  ]
  if (placeholder !== undefined) extensions.push(Placeholder.configure({ placeholder }))
  return extensions
}

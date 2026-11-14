// Clipboard behaviour for the description editor (spec §7):
// - Copy puts Markdown on the clipboard as text/plain (ProseMirror adds the HTML itself).
// - Pasting Markdown plain text becomes rich content (tables and task lists included).
// - Pasting rich HTML (web pages, Excel / Sheets tables) uses ProseMirror's HTML parser.
// - Plain text that merely contains a stray `*` or `_` is pasted as-is.
import { Extension, type Editor, type JSONContent } from '@tiptap/core'
import { Fragment, Slice, type Node as PMNode, type Schema } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { normalizeMarkdown } from './normalize'

const BLOCK_SIGNS: RegExp[] = [
  /^ {0,3}#{1,6}[ \t]+\S/m, // heading
  /^ {0,3}[-*+][ \t]+\[[ xX]\][ \t]/m, // task item
  /^ {0,3}(?:[-*+]|\d{1,9}[.)])[ \t]+\S/m, // list item
  /^ {0,3}>[ \t]?\S/m, // blockquote
  /^ {0,3}(?:```|~~~)/m, // code fence
  /^ {0,3}\|?[^\n|]*\|[^\n]*\n {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/m, // table
]

const INLINE_SIGNS: RegExp[] = [
  /\*\*[^*\s](?:[^*\n]*[^*\s])?\*\*/, // **bold**
  /(?<![\w_])__[^_\s](?:[^_\n]*[^_\s])?__(?![\w_])/, // __bold__
  /~~[^~\s](?:[^~\n]*[^~\s])?~~/, // ~~strike~~
  /(?<!`)`[^`\n]+`(?!`)/, // `code`
  /\[[^\]\n]+\]\((?:https?:|mailto:|\/|#)[^)\s]*\)/, // [text](url)
]

/**
 * Heuristic: does this plain text use Markdown syntax worth rendering? Deliberately strict for
 * inline syntax so prose with a stray `*` or `_` stays literal.
 */
export function looksLikeMarkdown(text: string): boolean {
  return BLOCK_SIGNS.some((re) => re.test(text)) || INLINE_SIGNS.some((re) => re.test(text))
}

/** HTML that carries real structure (as opposed to an editor's styled plain text). */
const STRUCTURAL_HTML =
  /<(?:table|ul|ol|li|h[1-6]|blockquote|strong|b|em|i|a|s|del|strike|img|hr)\b/i

/** Parses Markdown into a slice that merges into the surrounding paragraph where it can. */
export function markdownToSlice(editor: Editor, markdown: string): Slice | null {
  const manager = editor.markdown
  if (!manager) return null
  const json = manager.parse(markdown)
  if (!json.content?.length) return null
  const doc = editor.schema.nodeFromJSON(json)
  const first = doc.firstChild
  const last = doc.lastChild
  return new Slice(
    doc.content,
    first?.type.name === 'paragraph' ? 1 : 0,
    last?.type.name === 'paragraph' ? 1 : 0,
  )
}

function inCode(view: EditorView): boolean {
  const { $from } = view.state.selection
  return !!$from.parent.type.spec.code || $from.marks().some((m) => m.type.name === 'code')
}

/**
 * Decides whether a paste should be handled as Markdown. Returns the Markdown source to parse,
 * or null to let ProseMirror's default handling run.
 */
export function markdownForPaste(text: string, html: string): string | null {
  if (!text.trim()) return null
  // Copied from a ProseMirror editor (including this one): its HTML is exact.
  if (html && /data-pm-slice/.test(html)) return null
  // Rich HTML wins: it already describes the structure (web pages, Excel / Sheets tables).
  if (html && STRUCTURAL_HTML.test(html)) return null
  return looksLikeMarkdown(text) ? text : null
}

/** Wraps fragment pieces (rows, cells, list items) so they serialise as valid Markdown. */
function wrapForSerialization(schema: Schema, content: Fragment): Fragment {
  const first = content.firstChild
  if (!first) return content
  const wrap = (typeName: string, inner: Fragment): Fragment => {
    const type = schema.nodes[typeName]
    return type ? Fragment.from(type.create(null, inner)) : inner
  }
  switch (first.type.name) {
    case 'tableCell':
    case 'tableHeader':
      return wrap('table', wrap('tableRow', content))
    case 'tableRow':
      return wrap('table', content)
    case 'listItem':
      return wrap('bulletList', content)
    case 'taskItem':
      return wrap('taskList', content)
    default:
      return content
  }
}

/** Markdown for a copied slice (text/plain on the clipboard). */
export function sliceToMarkdown(editor: Editor, slice: Slice): string {
  const plain = (): string => slice.content.textBetween(0, slice.content.size, '\n\n')
  const manager = editor.markdown
  if (!manager) return plain()
  const only: PMNode | null = slice.content.childCount === 1 ? slice.content.firstChild : null
  // A selection inside a single text block: copy the inline Markdown, not the block syntax.
  if (only?.isTextblock && slice.openStart > 0 && slice.openEnd > 0) {
    if (only.type.spec.code) return only.textContent
    const json: JSONContent = {
      type: 'doc',
      content: [{ type: 'paragraph', content: only.content.toJSON() as JSONContent[] }],
    }
    return normalizeMarkdown(manager.serialize(json))
  }
  try {
    const content = wrapForSerialization(editor.schema, slice.content)
    const json: JSONContent = { type: 'doc', content: content.toJSON() as JSONContent[] }
    return normalizeMarkdown(manager.serialize(json))
  } catch {
    return plain()
  }
}

export const MarkdownClipboard = Extension.create({
  name: 'markdownClipboard',

  addProseMirrorPlugins() {
    const editor = this.editor
    return [
      new Plugin({
        key: new PluginKey('markdownClipboard'),
        props: {
          clipboardTextSerializer: (slice) => sliceToMarkdown(editor, slice),
          handlePaste: (view, event) => {
            const data = event.clipboardData
            if (!data || inCode(view)) return false
            const md = markdownForPaste(data.getData('text/plain'), data.getData('text/html'))
            if (md === null) return false
            const slice = markdownToSlice(editor, md)
            if (!slice) return false
            view.dispatch(
              view.state.tr
                .replaceSelection(slice)
                .scrollIntoView()
                .setMeta('paste', true)
                .setMeta('uiEvent', 'paste'),
            )
            return true
          },
        },
      }),
    ]
  },
})

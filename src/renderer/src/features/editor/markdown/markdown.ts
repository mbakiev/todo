// Headless Markdown helpers built on the editor schema.
import { Editor, type JSONContent } from '@tiptap/core'
import { createExtensions } from './extensions'
import { normalizeMarkdown } from './normalize'

export { normalizeMarkdown }

let headless: Editor | null = null

/** A lazily created, never-mounted editor used only for its MarkdownManager. */
function manager(): NonNullable<Editor['markdown']> {
  headless ??= new Editor({ extensions: createExtensions(), element: null })
  const m = headless.markdown
  if (!m) throw new Error('Markdown extension missing')
  return m
}

export function parseMarkdown(markdown: string): JSONContent {
  return manager().parse(markdown)
}

export function serializeMarkdown(doc: JSONContent): string {
  return normalizeMarkdown(manager().serialize(doc))
}

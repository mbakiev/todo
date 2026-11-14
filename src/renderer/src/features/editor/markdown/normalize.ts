import type { Editor } from '@tiptap/core'

/**
 * Canonical form for storage: no trailing whitespace at the end of the document, no leading
 * blank lines, and `\n` line endings. Everything else is the serializer's output.
 */
export function normalizeMarkdown(markdown: string): string {
  return markdown
    .replace(/\r\n?/g, '\n')
    .replace(/^(?:[ \t]*\n)+/, '')
    .replace(/\s+$/, '')
}

/** Current editor content as canonical Markdown. */
export function editorMarkdown(editor: Editor): string {
  return normalizeMarkdown(editor.getMarkdown())
}

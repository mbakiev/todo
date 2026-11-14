// Replaces `@tiptap/markdown`'s blanket text escaping with the context-aware escaper in
// ./escape.ts (see that file for why). `encodeTextForMarkdown` is a private method of
// MarkdownManager, so this is a deliberate, tested prototype patch; the round-trip tests in
// markdown.test.ts fail loudly if an upgrade renames or changes it.
import type { JSONContent } from '@tiptap/core'
import { MarkdownManager } from '@tiptap/markdown'
import { escapeMarkdownText } from './escape'
import { ENTITY_TEXT_RE, HTML_ENTITY_MARK } from './rawMarkdown'

interface PatchableManager {
  codeTypes: Set<string>
  encodeTextForMarkdown(text: string, node: JSONContent, parentNode?: JSONContent): string
}

const PATCHED = Symbol.for('martin-todos.markdown-escape-patch')

function isAtLineStart(node: JSONContent, parent: JSONContent | undefined): boolean {
  const siblings = parent?.content
  if (!siblings) return true
  const i = siblings.indexOf(node)
  if (i <= 0) return true
  return siblings[i - 1]?.type === 'hardBreak'
}

export function installMarkdownEscapePatch(): void {
  const proto = MarkdownManager.prototype as unknown as PatchableManager & Record<symbol, boolean>
  if (proto[PATCHED]) return
  if (typeof proto.encodeTextForMarkdown !== 'function') {
    throw new Error('@tiptap/markdown internals changed: encodeTextForMarkdown not found')
  }
  proto.encodeTextForMarkdown = function (
    this: PatchableManager,
    text: string,
    node: JSONContent,
    parentNode?: JSONContent,
  ): string {
    const inCode =
      (parentNode?.type != null && this.codeTypes.has(parentNode.type)) ||
      (node.marks ?? []).some((m) => this.codeTypes.has(m.type))
    if (inCode) return text
    // A parsed HTML entity reference (see rawMarkdown.ts) is written back verbatim.
    if ((node.marks ?? []).some((m) => m.type === HTML_ENTITY_MARK) && ENTITY_TEXT_RE.test(text))
      return text
    return escapeMarkdownText(text, isAtLineStart(node, parentNode))
  }
  proto[PATCHED] = true
}

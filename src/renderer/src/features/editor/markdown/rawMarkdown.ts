// Preservation nodes for Markdown the editor has no schema for: images, inline/block HTML,
// HTML comments and footnotes. Without these `@tiptap/markdown` silently drops images to their
// alt text, strips HTML tags and rewrites footnotes into links. The source is kept verbatim in
// an atom node (shown as a small monospace chip / box) and written back unchanged.
import { mergeAttributes, Node } from '@tiptap/core'

const INLINE_PATTERNS: RegExp[] = [
  // Image: ![alt](src "title") and ![alt][ref]
  /^!\[(?:\\.|[^\\\]\n])*\]\((?:\\.|[^\\)\n])*\)/,
  /^!\[(?:\\.|[^\\\]\n])*\]\[[^\]\n]*\]/,
  // HTML comment
  /^<!--[\s\S]*?-->/,
  // HTML open/close tag (not <br>, which maps to a hard break)
  /^<\/?(?!br\b)[A-Za-z][\w-]*(?:\s+[^<>]*?)?\/?>/i,
  // Footnote reference [^1]
  /^\[\^[^\]\s]+\]/,
]

const INLINE_START = /!\[|<[A-Za-z/!]|\[\^/

function matchInline(src: string): string | null {
  for (const re of INLINE_PATTERNS) {
    const m = re.exec(src)
    if (m) return m[0]
  }
  return null
}

const BLOCK_PATTERNS: RegExp[] = [
  // Footnote definition plus its indented continuation lines.
  /^\[\^[^\]\s]+\]:[^\n]*(?:\n[ \t]+\S[^\n]*)*/,
  // HTML block (comment or tag at line start) up to the next blank line.
  /^ {0,3}(?:<!--|<\/?(?!br\b)[A-Za-z][\w-]*(?=[\s/>]|$))[\s\S]*?(?=\n[ \t]*\n|\n?$)/i,
]

function matchBlock(src: string): string | null {
  for (const re of BLOCK_PATTERNS) {
    const m = re.exec(src)
    if (m && m[0].trim()) return m[0]
  }
  return null
}

const rawAttr = {
  raw: {
    default: '',
    parseHTML: (el: HTMLElement) => el.getAttribute('data-raw') ?? el.textContent ?? '',
    renderHTML: (attrs: Record<string, unknown>) => ({ 'data-raw': String(attrs['raw'] ?? '') }),
  },
}

export const RawInline = Node.create({
  name: 'rawInline',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return rawAttr
  },
  parseHTML() {
    return [{ tag: 'span[data-md-raw]' }]
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-md-raw': '',
        class: 'md-raw',
        contenteditable: 'false',
        title: 'Markdown the editor cannot display; kept as written',
      }),
      String(node.attrs['raw'] ?? ''),
    ]
  },
  renderText({ node }) {
    return String(node.attrs['raw'] ?? '')
  },

  markdownTokenName: 'rawInline',
  markdownTokenizer: {
    name: 'rawInline',
    level: 'inline',
    start: (src: string) => src.search(INLINE_START),
    tokenize: (src: string) => {
      const raw = matchInline(src)
      return raw ? { type: 'rawInline', raw, text: raw } : undefined
    },
  },
  parseMarkdown: (token) => ({ type: 'rawInline', attrs: { raw: token.raw ?? '' } }),
  renderMarkdown: (node) => String(node.attrs?.['raw'] ?? ''),
})

export const RawBlock = Node.create({
  name: 'rawBlock',
  group: 'block',
  atom: true,
  selectable: true,

  addAttributes() {
    return rawAttr
  },
  parseHTML() {
    return [{ tag: 'div[data-md-raw-block]' }]
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-md-raw-block': '',
        class: 'md-raw-block',
        contenteditable: 'false',
        title: 'Markdown the editor cannot display; kept as written',
      }),
      String(node.attrs['raw'] ?? ''),
    ]
  },
  renderText({ node }) {
    return String(node.attrs['raw'] ?? '')
  },

  markdownTokenName: 'rawBlock',
  markdownTokenizer: {
    name: 'rawBlock',
    level: 'block',
    // An explicit start is required: without one @tiptap/markdown probes with a throwaway lexer
    // that hijacks marked's shared tokenizer and leaves paragraphs without inline tokens.
    // `start` only decides where a paragraph may be cut; never interrupting one keeps HTML that
    // follows a paragraph line inline (preserved as raw chips), which is always lossless.
    start: () => -1,
    tokenize: (src: string) => {
      const raw = matchBlock(src)
      return raw ? { type: 'rawBlock', raw, text: raw } : undefined
    },
  },
  parseMarkdown: (token) => ({
    type: 'rawBlock',
    attrs: { raw: (token.raw ?? '').replace(/\n+$/, '') },
  }),
  renderMarkdown: (node) => String(node.attrs?.['raw'] ?? ''),
})

// Context-aware escaping of literal text for Markdown serialisation.
//
// `@tiptap/markdown` escapes every `\ ` * _ [ ] ~` and HTML-encodes every `& < >`, which turns
// `snake_case` into `snake\_case` and `a < b` into `a &lt; b` in storage. It also does not
// protect block syntax at the start of a line, so a paragraph that literally reads "# foo" or
// "1. foo" silently becomes a heading / list after a round-trip. This escaper only escapes what
// could actually be misread, and treats text-node boundaries (unknown neighbours) conservatively.

const ASCII_PUNCT = /[!-/:-@[-`{-~]/
const ALNUM = /[\p{L}\p{N}]/u
const SPACE = /\s/

const isSpace = (c: string | undefined): boolean => c === undefined || SPACE.test(c)
const isAlnum = (c: string | undefined): boolean => c !== undefined && ALNUM.test(c)

/**
 * Escapes inline-significant characters. `prev`/`next` are `undefined` at the text-node
 * boundary, where the neighbour is unknown (it may be markup), so we escape conservatively.
 */
function escapeInline(text: string): string {
  let out = ''
  for (let i = 0; i < text.length; i++) {
    const c = text.charAt(i)
    const prev = i > 0 ? text.charAt(i - 1) : undefined
    const next = i < text.length - 1 ? text.charAt(i + 1) : undefined
    switch (c) {
      case '\\':
        // A backslash is only special before punctuation, before a newline (hard break), or at
        // the node edge where the next character is unknown.
        out += next === undefined || next === '\n' || ASCII_PUNCT.test(next) ? '\\\\' : c
        break
      case '`':
      case '[':
      case ']':
        out += `\\${c}`
        break
      case '*':
      case '~':
        // A delimiter run surrounded by whitespace can neither open nor close emphasis.
        out +=
          prev !== undefined && next !== undefined && isSpace(prev) && isSpace(next) ? c : `\\${c}`
        break
      case '_':
        // GFM: intraword underscores never form emphasis (snake_case stays readable).
        out +=
          (isAlnum(prev) && isAlnum(next)) ||
          (prev !== undefined && next !== undefined && isSpace(prev) && isSpace(next))
            ? c
            : `\\${c}`
        break
      case '<':
        // Only a possible tag / autolink / comment start is special.
        out += next === undefined || /[A-Za-z/!?]/.test(next) ? '&lt;' : c
        break
      case '&':
        // Only a possible entity reference is special.
        out += /^&(?:#\d{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{0,31});/.test(text.slice(i))
          ? '&amp;'
          : c
        break
      default:
        out += c
    }
  }
  return out
}

/**
 * Splits a line into an already-escaped prefix (block syntax neutralised) and the rest, which
 * still needs inline escaping.
 */
function escapeLineStart(line: string): { prefix: string; rest: string } {
  const indentLen = /^ */.exec(line)?.[0].length ?? 0
  // 4+ leading spaces would start an indented code block; encode the first one.
  const indent = indentLen >= 4 ? `&#32;${line.slice(1, indentLen)}` : line.slice(0, indentLen)
  const body = line.slice(indentLen)
  const first = body.charAt(0)
  const escapeFirst =
    /^#{1,6}(?:\s|$)/.test(body) ||
    /^[-+*](?:\s|$)/.test(body) ||
    first === '>' ||
    /^=+\s*$/.test(body) ||
    /^(?:[-*_]\s*){3,}$/.test(body)
  if (escapeFirst) return { prefix: `${indent}\\${first}`, rest: body.slice(1) }
  const ol = /^(\d{1,9})([.)])(?=\s|$)/.exec(body)
  if (ol)
    return { prefix: `${indent}${ol[1] ?? ''}\\${ol[2] ?? ''}`, rest: body.slice(ol[0].length) }
  return { prefix: indent, rest: body }
}

/**
 * Escapes literal text for Markdown output.
 * @param atLineStart the text begins a line (start of a block or right after a hard break).
 */
export function escapeMarkdownText(text: string, atLineStart: boolean): string {
  return text
    .split('\n')
    .map((line, i) => {
      if (i === 0 && !atLineStart) return escapeInline(line)
      const { prefix, rest } = escapeLineStart(line)
      return prefix + escapeInline(rest)
    })
    .join('\n')
}

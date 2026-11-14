// Round-trip evidence for the description storage format (spec §7): Markdown → editor →
// Markdown must keep structure, be stable on the second pass, and never drop content the
// editor has no schema for.
import type { JSONContent } from '@tiptap/core'
import { normalizeMarkdown, parseMarkdown, serializeMarkdown } from './markdown'

function roundTrip(md: string): { out: string; doc: JSONContent } {
  const doc = parseMarkdown(md)
  return { out: serializeMarkdown(doc), doc }
}

/** md → out1 → out2: out1 === out2 and the parsed documents are identical. */
function expectStable(md: string): string {
  const first = roundTrip(md)
  const second = roundTrip(first.out)
  expect(second.out).toBe(first.out)
  expect(second.doc).toEqual(first.doc)
  return first.out
}

function find(doc: JSONContent, type: string): JSONContent[] {
  const out: JSONContent[] = []
  const walk = (n: JSONContent): void => {
    if (n.type === type) out.push(n)
    n.content?.forEach(walk)
  }
  walk(doc)
  return out
}

const marksOf = (doc: JSONContent, text: string): string[] =>
  find(doc, 'text')
    .find((t) => t.text === text)
    ?.marks?.map((m) => m.type) ?? []

describe('markdown round-trip (@tiptap/markdown)', () => {
  const exact: Array<[string, string]> = [
    ['headings', '# H1\n\n## H2\n\n### H3\n\n###### H6'],
    ['inline marks', 'Some **bold**, *italic*, ~~strike~~ and `inline code`.'],
    ['nested marks', '***both*** and **bold with `code` inside**'],
    ['link', 'See [the doc](https://example.com/a?b=1&c=2) now.'],
    ['link with title', '[t](https://a.b "Title")'],
    [
      'nested bullet + ordered lists',
      '- one\n- two\n  - nested a\n  - nested b\n- three\n\n1. first\n2. second\n   1. sub',
    ],
    ['ordered list start', '3. three\n4. four'],
    ['task list', '- [ ] open item\n- [x] done item\n  - [ ] nested open'],
    [
      'task list with formatting',
      '- [ ] **bold** task with [link](https://a.b)\n- [x] `code` done',
    ],
    ['blockquote', '> quoted **text**\n> second line'],
    ['blockquote with list', '> - a\n> - b'],
    ['fenced code with language', '```ts\nconst a = 1 < 2 && "x" // *not* emphasis\n```'],
    ['fenced code without language', '```\nplain\n```'],
    ['hard break', 'line one  \nline two'],
    ['soft break', 'line one\nline two'],
    ['horizontal rule', 'above\n\n---\n\nbelow'],
    ['blank lines between paragraphs', 'a\n\n\n\nb'],
    ['stray * and _ stay readable', 'a * b, snake_case_name, 2 * 3 and x_y'],
    ['entities and angle brackets', 'a & b, 1 < 2 > 0 and x&lt;y'],
    ['literal entity text', 'type &amp;amp; to get &amp;amp;'],
    ['backslash', 'C:\\Users\\martin and ends with \\\\'],
  ]

  it.each(exact)('%s', (_name, md) => {
    expect(expectStable(md)).toBe(md)
  })

  it('keeps heading / list / task / quote / code structure', () => {
    const doc = parseMarkdown(
      '# Title\n\n- [ ] todo\n- [x] done\n\n> quote\n\n```js\nx\n```\n\n1. a\n2. b',
    )
    expect(find(doc, 'heading')[0]?.attrs?.['level']).toBe(1)
    expect(find(doc, 'taskItem').map((t) => t.attrs?.['checked'])).toEqual([false, true])
    expect(find(doc, 'blockquote')).toHaveLength(1)
    expect(find(doc, 'codeBlock')[0]?.attrs?.['language']).toBe('js')
    expect(find(doc, 'orderedList')).toHaveLength(1)
  })

  it('marks', () => {
    const doc = parseMarkdown('**b** *i* ~~s~~ `c` [l](https://x.y)')
    expect(marksOf(doc, 'b')).toEqual(['bold'])
    expect(marksOf(doc, 'i')).toEqual(['italic'])
    expect(marksOf(doc, 's')).toEqual(['strike'])
    expect(marksOf(doc, 'c')).toEqual(['code'])
    expect(marksOf(doc, 'l')).toEqual(['link'])
  })

  describe('GFM tables', () => {
    const table =
      '| Owner | Item |\n| --- | --- |\n| **Anna** | `budget` draft |\n| Li | [link](https://x.y) |'

    it('parses header row and inline formatting in cells', () => {
      const doc = parseMarkdown(table)
      expect(find(doc, 'table')).toHaveLength(1)
      expect(find(doc, 'tableHeader')).toHaveLength(2)
      expect(find(doc, 'tableCell')).toHaveLength(4)
      expect(marksOf(doc, 'Anna')).toEqual(['bold'])
      expect(marksOf(doc, 'budget')).toEqual(['code'])
      expect(marksOf(doc, 'link')).toEqual(['link'])
    })

    it('serialises to a stable, aligned GFM table', () => {
      expect(expectStable(table)).toBe(
        [
          '| Owner    | Item                |',
          '| -------- | ------------------- |',
          '| **Anna** | `budget` draft      |',
          '| Li       | [link](https://x.y) |',
        ].join('\n'),
      )
    })

    it('keeps escaped pipes, empty cells and surrounding paragraphs', () => {
      const out = expectStable('Before\n\n| a | b |\n| --- | --- |\n| x \\| y |  |\n\nAfter')
      expect(out).toContain('x \\| y')
      expect(out.startsWith('Before\n\n|')).toBe(true)
      expect(out.endsWith('|\n\nAfter')).toBe(true)
    })

    it('is stable inside a list item', () => {
      // marked lets a table interrupt the item paragraph, so the blank line is dropped.
      expect(expectStable('- item\n\n  | a | b |\n  | --- | --- |\n  | 1 | 2 |')).toBe(
        '- item\n  | a   | b   |\n  | --- | --- |\n  | 1   | 2   |',
      )
    })
  })

  describe('literal text that looks like syntax keeps its meaning', () => {
    it.each([
      ['heading', '\\# not heading'],
      ['bullet', '\\- not a list'],
      ['plus', '\\+ not a list'],
      ['ordered', '1\\. not a list'],
      ['quote', '\\> not a quote'],
      ['rule', '\\---'],
      ['setext', 'title\n\\==='],
      ['emphasis', '\\*not italic\\* and \\_nor this\\_'],
      ['link', '\\[not a link\\](x)'],
      ['code', '\\`not code\\`'],
      ['html', '&lt;b&gt; is not bold'],
    ])('%s', (_name, md) => {
      const out = expectStable(md)
      const doc = parseMarkdown(out)
      expect(doc.content?.every((n) => n.type === 'paragraph')).toBe(true)
      expect(find(doc, 'text').every((t) => !t.marks?.length)).toBe(true)
    })
  })

  describe('content the editor does not understand is preserved verbatim', () => {
    it.each([
      ['image', 'pic ![alt text](https://x.y/a.png "t") here'],
      ['inline html', 'Some <span class="x">inline html</span> here'],
      ['html comment', 'a <!-- note --> b'],
      ['html block', '<details>\n<summary>More</summary>\n\nbody\n\n</details>'],
      ['footnotes', 'text[^1]\n\n[^1]: the note\n    continued'],
      ['br inside a table cell', '| a | b |\n| --- | --- |\n| x<br>y | z |'],
    ])('%s', (_name, md) => {
      const out = expectStable(md)
      // Compare ignoring table padding.
      const squash = (s: string): string => s.replace(/ {2,}/g, ' ').replace(/-{3,}/g, '---')
      expect(squash(out)).toBe(squash(md))
    })
  })

  it('normalises an empty document and stray whitespace', () => {
    expect(serializeMarkdown(parseMarkdown(''))).toBe('')
    expect(serializeMarkdown(parseMarkdown('\n\n  \n'))).toBe('')
    expect(normalizeMarkdown('\r\nhello\r\n\r\n')).toBe('hello')
  })
})

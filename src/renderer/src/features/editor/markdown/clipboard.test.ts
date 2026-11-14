import { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { looksLikeMarkdown, markdownForPaste, sliceToMarkdown } from './clipboard'
import { createExtensions } from './extensions'
import { normalizeMarkdown } from './normalize'

let editor: Editor

function mount(markdown: string): Editor {
  const element = document.createElement('div')
  document.body.appendChild(element)
  editor = new Editor({
    element,
    extensions: createExtensions(),
    content: markdown,
    contentType: 'markdown',
  })
  return editor
}

afterEach(() => {
  editor?.destroy()
  document.body.innerHTML = ''
})

function paste(data: Record<string, string>): void {
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', {
    value: { getData: (type: string) => data[type] ?? '', types: Object.keys(data) },
  })
  editor.view.dom.dispatchEvent(event)
}

const md = (): string => normalizeMarkdown(editor.getMarkdown())

describe('looksLikeMarkdown', () => {
  it.each([
    '# Heading',
    '- item',
    '1. first',
    '- [ ] task',
    '> quote',
    '```\ncode\n```',
    '| a | b |\n| --- | --- |\n| 1 | 2 |',
    'some **bold** text',
    'run `npm test` now',
    'see [docs](https://example.com)',
  ])('detects %j', (text) => expect(looksLikeMarkdown(text)).toBe(true))

  it.each([
    'just a sentence',
    'a * b * c',
    'snake_case_name and __init',
    '2*3 = 6, and 4 * 5',
    'Fix bug - see logs',
    'price: $5 *approx',
    'https://example.com/path_with_underscores',
  ])('leaves %j alone', (text) => expect(looksLikeMarkdown(text)).toBe(false))
})

describe('markdownForPaste', () => {
  it('prefers structured HTML (web pages, spreadsheets)', () => {
    expect(markdownForPaste('# a', '<table><tr><td>a</td></tr></table>')).toBeNull()
    expect(markdownForPaste('# a', '<h1>a</h1>')).toBeNull()
  })
  it('converts Markdown when the HTML is only styled plain text (code editors)', () => {
    expect(markdownForPaste('# a', '<div><span style="color:red"># a</span></div>')).toBe('# a')
  })
  it('never re-parses ProseMirror clipboard HTML', () => {
    expect(markdownForPaste('# a', '<p data-pm-slice="1 1 []"># a</p>')).toBeNull()
  })
})

describe('paste', () => {
  it('turns a pasted Markdown table into a table', () => {
    mount('Intro')
    editor.commands.focus('end')
    paste({ 'text/plain': '| Name | Done |\n| --- | --- |\n| **Ship** | yes |' })
    expect(editor.getJSON().content?.some((n) => n.type === 'table')).toBe(true)
    expect(md()).toContain('| **Ship** | yes  |')
  })

  it('turns a pasted task list into checkboxes', () => {
    mount('')
    editor.commands.focus()
    paste({ 'text/plain': '- [ ] one\n- [x] two' })
    expect(md()).toBe('- [ ] one\n- [x] two')
  })

  it('merges pasted inline Markdown into the current paragraph', () => {
    mount('Hello world')
    editor.commands.setTextSelection(7)
    paste({ 'text/plain': 'the **bold** ' })
    expect(md()).toBe('Hello the **bold** world')
  })

  it('pastes plain text with stray * and _ literally', () => {
    mount('')
    editor.commands.focus()
    paste({ 'text/plain': 'a * b and snake_case' })
    expect(editor.getText()).toBe('a * b and snake_case')
    expect(md()).toBe('a * b and snake_case')
  })

  it('keeps structure from pasted HTML tables (Excel / Sheets)', () => {
    mount('')
    editor.commands.focus()
    paste({
      'text/plain': 'Owner\tItem\nAnna\tBudget',
      'text/html':
        '<meta charset="utf-8"><google-sheets-html-origin><table><tbody><tr><td>Owner</td><td>Item</td></tr><tr><td>Anna</td><td><b>Budget</b></td></tr></tbody></table>',
    })
    expect(editor.getJSON().content?.some((n) => n.type === 'table')).toBe(true)
    expect(md()).toContain('Anna')
    expect(md()).toContain('**Budget**')
  })

  it('pastes Markdown literally inside a code block', () => {
    mount('```\nx\n```')
    editor.commands.setTextSelection(2)
    paste({ 'text/plain': '# not a heading' })
    const first = editor.state.doc.firstChild
    expect(first?.type.name).toBe('codeBlock')
    expect(first?.textContent).toBe('x# not a heading')
    expect(editor.getJSON().content?.some((n) => n.type === 'heading')).toBe(false)
  })
})

describe('copy', () => {
  const copied = (from: number, to: number): string => {
    const { state } = editor
    const sel = TextSelection.create(state.doc, from, to)
    return sliceToMarkdown(editor, sel.content())
  }

  it('copies inline Markdown for a selection inside a paragraph', () => {
    mount('Some **bold** text')
    // "Some bold" → positions 1..10
    expect(copied(1, 10)).toBe('Some **bold**')
  })

  it('copies block Markdown across blocks', () => {
    mount('# Title\n\n- [ ] task\n- [x] done')
    expect(copied(0, editor.state.doc.content.size)).toBe('# Title\n\n- [ ] task\n- [x] done')
  })

  it('copies raw text from inside a code block', () => {
    mount('```js\nconst a = 1\n```')
    expect(copied(1, 6)).toBe('const')
  })

  it('serialises the clipboard text/plain via the editor', () => {
    mount('A **b**')
    const text = editor.view.someProp('clipboardTextSerializer', (f) =>
      f(editor.state.doc.slice(0, editor.state.doc.content.size), editor.view),
    )
    expect(text).toBe('A **b**')
  })
})

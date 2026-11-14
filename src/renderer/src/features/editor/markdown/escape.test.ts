import { escapeMarkdownText } from './escape'

describe('escapeMarkdownText', () => {
  it.each([
    ['snake_case_name', 'snake_case_name'],
    ['a * b', 'a * b'],
    ['*emph*', '\\*emph\\*'],
    ['_x_', '\\_x\\_'],
    ['`code`', '\\`code\\`'],
    ['[a](b)', '\\[a\\](b)'],
    ['1 < 2', '1 < 2'],
    ['<b>', '&lt;b>'],
    ['AT&T', 'AT&T'],
    ['&amp;', '&amp;amp;'],
    ['C:\\dir', 'C:\\dir'],
    ['\\*', '\\\\\\*'],
    ['ends\\', 'ends\\\\'],
  ])('inline %j → %j', (input, expected) => {
    expect(escapeMarkdownText(input, false)).toBe(expected)
  })

  it.each([
    ['# x', '\\# x'],
    ['#hashtag', '#hashtag'],
    ['- x', '\\- x'],
    ['+ x', '\\+ x'],
    ['* x', '\\* x'],
    ['1. x', '1\\. x'],
    ['2) x', '2\\) x'],
    ['2026. was a year', '2026\\. was a year'],
    ['3.5 apples', '3.5 apples'],
    ['> x', '\\> x'],
    ['---', '\\---'],
    ['===', '\\==='],
    ['    four spaces', '&#32;   four spaces'],
  ])('line start %j → %j', (input, expected) => {
    expect(escapeMarkdownText(input, true)).toBe(expected)
  })

  it('escapes line starts after soft line breaks', () => {
    expect(escapeMarkdownText('a\n# b\n- c', false)).toBe('a\n\\# b\n\\- c')
  })

  it('does not treat mid-line text as a line start', () => {
    expect(escapeMarkdownText('# x', false)).toBe('# x')
  })
})

import { act, render, screen } from '@testing-library/react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { MarkdownEditor } from './MarkdownEditor'

// jsdom lacks layout APIs ProseMirror / floating-ui touch.
beforeAll(() => {
  Range.prototype.getBoundingClientRect = () => new DOMRect()
  Range.prototype.getClientRects = () =>
    ({
      length: 0,
      item: () => null,
      [Symbol.iterator]: [][Symbol.iterator],
    }) as unknown as DOMRectList
  document.elementFromPoint = () => null
})

function setup(value: string) {
  const onChange = vi.fn()
  const view = render(
    <TooltipProvider>
      <MarkdownEditor value={value} onChange={onChange} />
    </TooltipProvider>,
  )
  const rerender = (next: string): void =>
    view.rerender(
      <TooltipProvider>
        <MarkdownEditor value={next} onChange={onChange} />
      </TooltipProvider>,
    )
  return { onChange, rerender, content: () => screen.getByRole('textbox', { name: 'Description' }) }
}

describe('MarkdownEditor', () => {
  it('renders Markdown as rich content', () => {
    const { content } = setup('# Hello\n\n- [x] done\n\n| a | b |\n| --- | --- |\n| 1 | 2 |')
    expect(content().querySelector('h1')?.textContent).toBe('Hello')
    expect(content().querySelector('input[type="checkbox"]')).toBeChecked()
    expect(content().querySelectorAll('th')).toHaveLength(2)
  })

  it('does not report a change just because the serialiser formats differently', () => {
    const { onChange } = setup('| a | b |\n| --- | --- |\n| 1 | 2 |\n\n\n')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('adopts external value changes', () => {
    const { content, rerender, onChange } = setup('first')
    act(() => rerender('**second**'))
    expect(content().querySelector('strong')?.textContent).toBe('second')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('shows the toolbar with shortcuts', () => {
    setup('')
    expect(screen.getByRole('toolbar', { name: 'Formatting' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Bold' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Insert table' })).toBeInTheDocument()
  })
})

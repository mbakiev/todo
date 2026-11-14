import { act, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  resetTooltipInteractionForTests,
} from './tooltip'

function Tip({ defaultOpen = false }: { defaultOpen?: boolean }) {
  return (
    <Tooltip defaultOpen={defaultOpen}>
      <TooltipTrigger asChild>
        <button type="button">Trigger</button>
      </TooltipTrigger>
      <TooltipContent>Tip text</TooltipContent>
    </Tooltip>
  )
}

const tipShown = (): boolean => document.querySelector('[data-slot="tooltip-content"]') !== null

beforeAll(() => {
  // jsdom has no ResizeObserver (Radix's popper measures the arrow with one).
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
})

beforeEach(() => resetTooltipInteractionForTests())

describe('Tooltip wrapper', () => {
  it('does not open when focus is moved programmatically (menu / popover focus return)', () => {
    render(
      <TooltipProvider>
        <Tip />
      </TooltipProvider>,
    )
    // Esc closed some menu, which hands focus back to its trigger.
    fireEvent.keyDown(window, { key: 'Escape' })
    act(() => screen.getByRole('button', { name: 'Trigger' }).focus())
    expect(tipShown()).toBe(false)
  })

  it('opens when focus arrives by keyboard navigation (Tab)', () => {
    render(
      <TooltipProvider>
        <Tip />
      </TooltipProvider>,
    )
    fireEvent.keyDown(window, { key: 'Tab' })
    act(() => screen.getByRole('button', { name: 'Trigger' }).focus())
    expect(tipShown()).toBe(true)
  })

  it('an open tooltip does not consume Esc: listeners below still see an unhandled Esc', () => {
    const seen: boolean[] = []
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') seen.push(e.defaultPrevented)
    }
    window.addEventListener('keydown', onKey)
    render(
      <TooltipProvider>
        <Tip defaultOpen />
      </TooltipProvider>,
    )
    expect(tipShown()).toBe(true)
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    window.removeEventListener('keydown', onKey)
    expect(tipShown()).toBe(false)
    // No popper wrapper left behind (the shell treats one as "an overlay owns Esc").
    expect(document.querySelector('[data-radix-popper-content-wrapper]')).toBeNull()
    expect(seen).toEqual([false])
  })

  it('one Esc closes both an open tooltip and the dialog it sits in', () => {
    function Harness() {
      const [open, setOpen] = useState(true)
      return (
        <TooltipProvider>
          <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
            <DialogPrimitive.Portal>
              <DialogPrimitive.Content aria-describedby={undefined}>
                <DialogPrimitive.Title>Dialog</DialogPrimitive.Title>
                <Tip defaultOpen />
              </DialogPrimitive.Content>
            </DialogPrimitive.Portal>
          </DialogPrimitive.Root>
          <span data-testid="state">{open ? 'open' : 'closed'}</span>
        </TooltipProvider>
      )
    }
    render(<Harness />)
    expect(tipShown()).toBe(true)
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    expect(tipShown()).toBe(false)
    expect(screen.getByTestId('state').textContent).toBe('closed')
  })

  it('re-opens on the next hover after an Esc', async () => {
    render(
      <TooltipProvider>
        <Tip defaultOpen />
      </TooltipProvider>,
    )
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(tipShown()).toBe(false)
    fireEvent.pointerMove(screen.getByRole('button', { name: 'Trigger' }), { pointerType: 'mouse' })
    // The provider's open delay (0 ms) still goes through a timer.
    await act(() => new Promise((r) => setTimeout(r, 10)))
    expect(tipShown()).toBe(true)
  })
})

import { render, screen } from '@testing-library/react'
import { addDays, todayLocal } from '@shared/dates'
import { makeTask } from '@shared/test/factories'
import type { Tag } from '@shared/types'
import { useTagsStore } from '@/stores/tagsStore'
import { CardBody } from './BoardCard'

const tag = (id: string, name: string): Tag => ({ id, name, color: 'blue', createdAt: 0 })

beforeEach(() =>
  useTagsStore.setState({
    byId: { z: tag('z', 'zebra'), a: tag('a', 'Apple'), m: tag('m', 'mango') },
    loaded: true,
    sync: {},
  }),
)

describe('board card meta row', () => {
  it('a start-only task shows a muted "Starts <date>" badge', () => {
    const start = addDays(todayLocal(), 10)
    render(<CardBody task={makeTask({ startDate: start, dueDate: null })} />)
    const badge = screen.getByTestId('start-date-badge')
    expect(badge.textContent).toMatch(/^Starts /)
    expect(badge.className).toContain('text-muted-foreground')
    expect(badge.className).not.toMatch(/text-overdue|text-due-today/)
  })

  it('a past start date is still muted, never overdue-red', () => {
    const start = addDays(todayLocal(), -5)
    render(<CardBody task={makeTask({ startDate: start, dueDate: null })} />)
    expect(screen.getByTestId('start-date-badge').className).not.toContain('text-overdue')
  })

  it('a task with both dates shows only the due badge', () => {
    const today = todayLocal()
    render(<CardBody task={makeTask({ startDate: addDays(today, -1), dueDate: today })} />)
    expect(screen.queryByTestId('start-date-badge')).toBeNull()
    expect(screen.getByTitle(`Due ${today}`)).toHaveClass('text-due-today')
  })

  it('renders an empty (hidden) meta row when there is nothing to show', () => {
    // Only a tag id that no longer exists: nothing renders inside the row.
    render(<CardBody task={makeTask({ tagIds: ['gone'] })} />)
    const meta = screen.getByTestId('card-meta')
    expect(meta).toBeEmptyDOMElement()
    expect(meta).toHaveClass('empty:hidden')
  })

  it('shows tag chips alphabetically', () => {
    render(<CardBody task={makeTask({ tagIds: ['z', 'm', 'a'] })} />)
    const names = Array.from(screen.getByTestId('card-meta').querySelectorAll('span.truncate')).map(
      (s) => s.textContent,
    )
    expect(names).toEqual(['Apple', 'mango', 'zebra'])
  })
})

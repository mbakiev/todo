import { buildInlineCreateInput, inlineAddError } from './inlineAdd'

const opts = {
  today: '2026-11-13', // a Friday
  weekStartsOn: 1 as const,
  findTagByName: (name: string) => (name.toLowerCase() === 'work' ? { id: 'tag-work' } : undefined),
}

describe('buildInlineCreateInput', () => {
  it('returns null for empty or token-only text', () => {
    expect(buildInlineCreateInput('   ', opts)).toBeNull()
    expect(buildInlineCreateInput('#work !high', opts)).toBeNull()
  })

  it('creates a plain Not Started task with default priority', () => {
    expect(buildInlineCreateInput('Call Bob', opts)).toEqual({
      title: 'Call Bob',
      status: 'not_started',
      priority: 2,
      dueDate: null,
      tagIds: [],
      newTagNames: [],
    })
  })

  it('parses tags (existing vs new), priority and due date', () => {
    expect(buildInlineCreateInput('Ship it #Work #launch !crit @tomorrow', opts)).toEqual({
      title: 'Ship it',
      status: 'not_started',
      priority: 4,
      dueDate: '2026-11-14',
      tagIds: ['tag-work'],
      newTagNames: ['launch'],
    })
  })

  it('keeps non-date @mentions in the title', () => {
    expect(buildInlineCreateInput('Ping @john', opts)?.title).toBe('Ping @john')
  })
})

describe('inline add title limit', () => {
  it('flags and refuses a cleaned title over 500 characters', () => {
    const long = `${'x'.repeat(501)} !high`
    expect(inlineAddError(long, opts)).toBe('Title is too long: 501 of 500 characters.')
    expect(buildInlineCreateInput(long, opts)).toBeNull()
    expect(inlineAddError(`${'x'.repeat(500)} !high`, opts)).toBeNull()
  })
})

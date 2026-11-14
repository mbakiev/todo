import { buildInlineCreateInput } from './inlineAdd'

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

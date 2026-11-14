import { z } from 'zod'
import { taskCreateInputSchema, taskUpdatePatchSchema, tagCreateInputSchema } from './schemas'
import { describeValidationIssue } from './validationMessage'

const first = (schema: z.ZodType, value: unknown) => {
  const r = schema.safeParse(value)
  if (r.success) throw new Error('expected a failure')
  return r.error.issues[0]
}

describe('describeValidationIssue', () => {
  it('turns zod issues into one plain sentence', () => {
    expect(
      describeValidationIssue(
        first(taskCreateInputSchema, { title: 'x', newTagNames: ['a'.repeat(51)] }),
      ),
    ).toBe('The tag name is too long (at most 50 characters).')
    expect(describeValidationIssue(first(taskUpdatePatchSchema, { title: 'x'.repeat(501) }))).toBe(
      'The title is too long (at most 500 characters).',
    )
    expect(describeValidationIssue(first(tagCreateInputSchema, { name: '  ' }))).toBe(
      "The tag name can't be empty.",
    )
    expect(
      describeValidationIssue(
        first(taskUpdatePatchSchema, { startDate: '2026-02-02', dueDate: '2026-01-01' }),
      ),
    ).toBe('Start date must not be after due date.')
    expect(describeValidationIssue(first(taskUpdatePatchSchema, { priority: 9 }))).toBe(
      'The priority is not valid.',
    )
    expect(
      describeValidationIssue(
        first(taskCreateInputSchema, { title: 'x', tagIds: Array(101).fill('a') }),
      ),
    ).toBe('Too many tags (at most 100).')
  })

  it('never leaks a schema path', () => {
    const msg = describeValidationIssue(
      first(z.tuple([taskCreateInputSchema]), [{ title: 'x', newTagNames: ['b'.repeat(80)] }]),
    )
    expect(msg).not.toMatch(/\d\.|newTagNames|expected/)
  })
})

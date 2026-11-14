import { beforeEach, describe, expect, it } from 'vitest'
import { setLeaveGuard, useUiStore } from './uiStore'

describe('uiStore.openNewTaskDialog', () => {
  beforeEach(() => useUiStore.setState({ newTaskDialog: { open: false, prefill: {} } }))

  it('opens with the given prefill', () => {
    useUiStore.getState().openNewTaskDialog({ dueDate: '2026-11-20' })
    expect(useUiStore.getState().newTaskDialog).toEqual({
      open: true,
      prefill: { dueDate: '2026-11-20' },
    })
  })

  it('a second open while open keeps the first prefill', () => {
    useUiStore.getState().openNewTaskDialog({ dueDate: '2026-11-20' })
    useUiStore.getState().openNewTaskDialog()
    expect(useUiStore.getState().newTaskDialog.prefill).toEqual({ dueDate: '2026-11-20' })
  })
})

describe('uiStore.retainFilterTags', () => {
  it('drops filter tags that no longer exist and keeps the rest in order', () => {
    useUiStore.getState().setFilterTags(['a', 'gone', 'b'])
    useUiStore.getState().retainFilterTags(new Set(['a', 'b', 'c']))
    expect(useUiStore.getState().filter.tagIds).toEqual(['a', 'b'])
    const before = useUiStore.getState().filter
    useUiStore.getState().retainFilterTags(new Set(['a', 'b']))
    expect(useUiStore.getState().filter).toBe(before) // no-op keeps identity
  })
})

describe('uiStore.selectTask leave guard', () => {
  beforeEach(() => useUiStore.setState({ selectedTaskId: 'a' }))

  it('switches immediately when the guard has nothing pending', () => {
    const off = setLeaveGuard(() => null)
    useUiStore.getState().selectTask('b')
    expect(useUiStore.getState().selectedTaskId).toBe('b')
    off()
  })

  it('stays on the task when the guard cannot save, leaves once it can', async () => {
    let allow = false
    const off = setLeaveGuard(() => Promise.resolve(allow))
    useUiStore.getState().selectTask(null)
    await Promise.resolve()
    await Promise.resolve()
    expect(useUiStore.getState().selectedTaskId).toBe('a')
    allow = true
    useUiStore.getState().selectTask('b')
    await vi.waitFor(() => expect(useUiStore.getState().selectedTaskId).toBe('b'))
    off()
  })

  it('force skips the guard (task deleted, temp id resolved)', () => {
    const guard = vi.fn(() => Promise.resolve(false))
    const off = setLeaveGuard(guard)
    useUiStore.getState().selectTask(null, { force: true })
    expect(useUiStore.getState().selectedTaskId).toBeNull()
    expect(guard).not.toHaveBeenCalled()
    off()
  })
})

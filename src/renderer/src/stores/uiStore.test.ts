import { beforeEach, describe, expect, it } from 'vitest'
import { useUiStore } from './uiStore'

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

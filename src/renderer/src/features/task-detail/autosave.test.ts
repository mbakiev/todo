import { act, renderHook } from '@testing-library/react'
import type { Task } from '@shared/types'
import { makeTask } from '@shared/test/factories'
import { useTasksStore } from '@/stores/tasksStore'
import { installMockApi } from '@/test/mockApi'
import { createAutosave } from './autosave'
import { saveTaskPatch } from './saveTask'
import { useDraftField } from './useDraftField'

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }))

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('createAutosave', () => {
  it('debounces to the last value', () => {
    const save = vi.fn()
    const a = createAutosave(save, 500)
    a.set('a')
    vi.advanceTimersByTime(300)
    a.set('ab')
    vi.advanceTimersByTime(499)
    expect(save).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(save).toHaveBeenCalledExactlyOnceWith('ab')
    expect(a.dirty).toBe(false)
  })

  it('flush saves immediately, once', () => {
    const save = vi.fn()
    const a = createAutosave(save, 500)
    a.set('x')
    expect(a.dirty).toBe(true)
    a.flush()
    a.flush()
    vi.runAllTimers()
    expect(save).toHaveBeenCalledExactlyOnceWith('x')
  })

  it('cancel drops the pending value', () => {
    const save = vi.fn()
    const a = createAutosave(save, 500)
    a.set('x')
    a.cancel()
    vi.runAllTimers()
    a.flush()
    expect(save).not.toHaveBeenCalled()
  })
})

describe('useDraftField', () => {
  const setup = (initial: string, opts: { title?: boolean } = {}) => {
    const save = vi.fn()
    const hook = renderHook(
      ({ value }: { value: string }) =>
        useDraftField({
          value,
          save,
          ...(opts.title
            ? { normalize: (v: string) => v.trim(), isValid: (v: string) => v.trim() !== '' }
            : {}),
        }),
      { initialProps: { value: initial } },
    )
    return { save, hook }
  }

  it('saves edits after the debounce and on unmount', () => {
    const { save, hook } = setup('a')
    act(() => hook.result.current.change('ab'))
    expect(hook.result.current.draft).toBe('ab')
    act(() => vi.advanceTimersByTime(500))
    expect(save).toHaveBeenLastCalledWith('ab')
    act(() => hook.result.current.change('abc'))
    hook.unmount()
    expect(save).toHaveBeenLastCalledWith('abc')
    expect(save).toHaveBeenCalledTimes(2)
  })

  it('does not save when the value returns to the saved one', () => {
    const { save, hook } = setup('a')
    act(() => hook.result.current.change('ab'))
    act(() => hook.result.current.change('a'))
    hook.unmount()
    expect(save).not.toHaveBeenCalled()
  })

  it('adopts external changes only while not dirty', () => {
    const { hook } = setup('a')
    hook.rerender({ value: 'remote' })
    expect(hook.result.current.draft).toBe('remote')
    act(() => hook.result.current.change('local'))
    hook.rerender({ value: 'remote 2' })
    expect(hook.result.current.draft).toBe('local')
  })

  it('ignores the echo of its own (normalised) save', () => {
    const { save, hook } = setup('Title', { title: true })
    act(() => hook.result.current.change('New '))
    act(() => vi.advanceTimersByTime(500))
    expect(save).toHaveBeenLastCalledWith('New')
    // The store comes back trimmed; the trailing space the user is typing must survive.
    hook.rerender({ value: 'New' })
    expect(hook.result.current.draft).toBe('New ')
  })

  it('never saves an empty title and reverts it on commit', () => {
    const { save, hook } = setup('Title', { title: true })
    act(() => hook.result.current.change('Tit'))
    act(() => hook.result.current.change(''))
    act(() => vi.advanceTimersByTime(1000))
    act(() => hook.result.current.commit())
    expect(save).not.toHaveBeenCalled()
    expect(hook.result.current.draft).toBe('Title')
  })

  it('binds the save target at creation (task switch cannot redirect a draft)', () => {
    const saveA = vi.fn()
    const saveB = vi.fn()
    const hook = renderHook(
      ({ save }: { save: (v: string) => void }) => useDraftField({ value: 'x', save }),
      { initialProps: { save: saveA } },
    )
    act(() => hook.result.current.change('typed in A'))
    hook.rerender({ save: saveB })
    hook.unmount()
    expect(saveA).toHaveBeenCalledExactlyOnceWith('typed in A')
    expect(saveB).not.toHaveBeenCalled()
  })

  describe('when a save fails', () => {
    const task: Task = makeTask({ id: 'a', description: 'old text' })

    /** The detail panel's wiring: value from the store, save through saveTaskPatch. */
    function setupWithStore() {
      useTasksStore.setState({ byId: { a: task }, loaded: true, pending: {}, sync: {} })
      const hook = renderHook(() =>
        useDraftField({
          value: useTasksStore((s) => s.byId.a?.description ?? ''),
          save: (v) => saveTaskPatch('a', { description: v }),
          isValid: (v) => v.length <= 20,
        }),
      )
      return hook
    }

    it('keeps the typed text, shows "failed", ignores the rollback and retries on flush', async () => {
      const update = vi.fn((): Promise<Task> => Promise.reject(new Error('disk full')))
      installMockApi({ tasks: { update } })
      const hook = setupWithStore()
      act(() => hook.result.current.change('typed text'))
      await act(async () => {
        vi.advanceTimersByTime(500)
      })
      expect(update).toHaveBeenCalledTimes(1)
      // The store rolled back to "old text"; the field must not adopt it.
      expect(useTasksStore.getState().byId.a?.description).toBe('old text')
      expect(hook.result.current.draft).toBe('typed text')
      expect(hook.result.current.status).toBe('failed')
      expect(hook.result.current.dirty).toBe(true)

      // A later flush (blur, panel close, window hide) saves it again.
      update.mockImplementation(() =>
        Promise.resolve({ ...task, description: 'typed text', updatedAt: task.updatedAt + 1 }),
      )
      await act(async () => hook.result.current.flush())
      expect(update).toHaveBeenCalledTimes(2)
      expect(update).toHaveBeenLastCalledWith('a', { description: 'typed text' })
      expect(hook.result.current.status).toBe('saved')
      expect(hook.result.current.draft).toBe('typed text')
      expect(useTasksStore.getState().byId.a?.description).toBe('typed text')
    })

    it('reports a retry that is still in flight as saving (not dirty, but not settled)', async () => {
      let reject: (e: Error) => void = () => {}
      const update = vi.fn(
        (): Promise<Task> =>
          new Promise((_resolve, rej) => {
            reject = rej
          }),
      )
      installMockApi({ tasks: { update } })
      const hook = setupWithStore()
      act(() => hook.result.current.change('typed text'))
      await act(async () => {
        vi.advanceTimersByTime(500)
      })
      expect(update).toHaveBeenCalledTimes(1)
      expect(hook.result.current.dirty).toBe(false)
      expect(hook.result.current.saving).toBe(true)
      await act(async () => reject(new Error('disk full')))
      expect(hook.result.current.saving).toBe(false)
      expect(hook.result.current.dirty).toBe(true)
    })

    it('the next edit retries too, with the newest text', async () => {
      const update = vi.fn((): Promise<Task> => Promise.reject(new Error('nope')))
      installMockApi({ tasks: { update } })
      const hook = setupWithStore()
      act(() => hook.result.current.change('first'))
      await act(async () => {
        vi.advanceTimersByTime(500)
      })
      expect(hook.result.current.status).toBe('failed')
      update.mockImplementation(() =>
        Promise.resolve({ ...task, description: 'first!', updatedAt: task.updatedAt + 1 }),
      )
      act(() => hook.result.current.change('first!'))
      await act(async () => {
        vi.advanceTimersByTime(500)
      })
      expect(update).toHaveBeenLastCalledWith('a', { description: 'first!' })
      expect(hook.result.current.status).toBe('saved')
    })

    it('a draft over the limit is flagged, never sent and never overwritten', async () => {
      const update = vi.fn()
      installMockApi({ tasks: { update } })
      const hook = setupWithStore()
      act(() => hook.result.current.change('x'.repeat(21)))
      expect(hook.result.current.status).toBe('invalid')
      await act(async () => {
        vi.advanceTimersByTime(1000)
        hook.result.current.flush()
      })
      expect(update).not.toHaveBeenCalled()
      // An external change does not replace the over-long draft.
      act(() =>
        useTasksStore.getState().applyChange({
          upsertedTasks: [{ ...task, description: 'remote', updatedAt: task.updatedAt + 5 }],
        }),
      )
      expect(hook.result.current.draft).toBe('x'.repeat(21))
      // Shortening it saves again.
      update.mockImplementation(() =>
        Promise.resolve({ ...task, description: 'short', updatedAt: task.updatedAt + 9 }),
      )
      act(() => hook.result.current.change('short'))
      expect(hook.result.current.status).toBe('saved')
      await act(async () => {
        vi.advanceTimersByTime(500)
      })
      expect(update).toHaveBeenCalledExactlyOnceWith('a', { description: 'short' })
    })
  })

  describe('flushAsync and recovered drafts', () => {
    it('flushAsync reports failure, then success once the save goes through; outcome callbacks fire', async () => {
      let ok = false
      const save = vi.fn(() => Promise.resolve(ok))
      const onSaveFailed = vi.fn()
      const onSaveSucceeded = vi.fn()
      const hook = renderHook(() =>
        useDraftField({ value: 'old', save, onSaveFailed, onSaveSucceeded }),
      )
      act(() => hook.result.current.change('new text'))
      let result = true
      await act(async () => {
        result = await hook.result.current.flushAsync()
      })
      expect(result).toBe(false)
      expect(onSaveFailed).toHaveBeenCalledWith('new text')
      expect(hook.result.current.status).toBe('failed')
      ok = true
      await act(async () => {
        result = await hook.result.current.flushAsync()
      })
      expect(result).toBe(true)
      expect(onSaveSucceeded).toHaveBeenCalledTimes(1)
      expect(save).toHaveBeenCalledTimes(2)
      expect(hook.result.current.status).toBe('saved')
    })

    it('flushAsync is true when nothing is pending', async () => {
      const hook = renderHook(() => useDraftField({ value: 'x', save: vi.fn() }))
      await expect(hook.result.current.flushAsync()).resolves.toBe(true)
    })

    it('recovered text is shown, not saved and not overwritten until kept', async () => {
      const save = vi.fn(() => Promise.resolve(true))
      const hook = renderHook(
        ({ value }: { value: string }) =>
          useDraftField({ value, save, recovered: 'recovered text' }),
        { initialProps: { value: 'saved text' } },
      )
      expect(hook.result.current.draft).toBe('recovered text')
      expect(hook.result.current.status).toBe('recovered')
      act(() => vi.advanceTimersByTime(2000))
      expect(save).not.toHaveBeenCalled()
      hook.rerender({ value: 'changed elsewhere' })
      expect(hook.result.current.draft).toBe('recovered text')
      // Leaving with an undecided recovered draft is allowed (it stays stored).
      await expect(hook.result.current.flushAsync()).resolves.toBe(true)
      await act(async () => hook.result.current.keepRecovered())
      expect(save).toHaveBeenCalledExactlyOnceWith('recovered text')
      expect(hook.result.current.status).toBe('saved')
    })

    it('discarding recovered text shows the saved value and reports it', () => {
      const onDiscardRecovered = vi.fn()
      const save = vi.fn()
      const hook = renderHook(() =>
        useDraftField({ value: 'saved', save, recovered: 'stale', onDiscardRecovered }),
      )
      act(() => hook.result.current.discardRecovered())
      expect(hook.result.current.draft).toBe('saved')
      expect(hook.result.current.status).toBe('saved')
      expect(onDiscardRecovered).toHaveBeenCalledTimes(1)
      act(() => vi.advanceTimersByTime(2000))
      expect(save).not.toHaveBeenCalled()
    })
  })
})

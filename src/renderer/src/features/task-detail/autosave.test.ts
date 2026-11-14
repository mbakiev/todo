import { act, renderHook } from '@testing-library/react'
import { createAutosave } from './autosave'
import { useDraftField } from './useDraftField'

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
})

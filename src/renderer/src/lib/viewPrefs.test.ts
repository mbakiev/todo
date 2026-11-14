import { beforeEach, describe, expect, it } from 'vitest'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { isOneOf, keepIf, viewPrefs, VIEW_PREFS_PREFIX } from './viewPrefs'

interface S {
  mode: 'a' | 'b'
  session: number
  setMode(m: 'a' | 'b'): void
}

function makeStore() {
  return create<S>()(
    persist(
      (set) => ({ mode: 'a', session: 0, setMode: (mode) => set({ mode }) }),
      viewPrefs<S, { mode: 'a' | 'b' }>(
        'test',
        (s) => ({ mode: s.mode }),
        (saved) => {
          const out: Partial<S> = {}
          keepIf(out, 'mode', saved.mode, isOneOf(['a', 'b'] as const))
          return out
        },
      ),
    ),
  )
}

describe('viewPrefs', () => {
  beforeEach(() => window.localStorage.clear())

  it('persists only the picked fields under a namespaced key', () => {
    const store = makeStore()
    store.getState().setMode('b')
    const raw = JSON.parse(window.localStorage.getItem(`${VIEW_PREFS_PREFIX}test`) ?? 'null')
    expect(raw.state).toEqual({ mode: 'b' })
    expect(makeStore().getState().mode).toBe('b')
  })

  it('drops invalid saved values', () => {
    window.localStorage.setItem(
      `${VIEW_PREFS_PREFIX}test`,
      JSON.stringify({ state: { mode: 'zzz', session: 9 }, version: 1 }),
    )
    const s = makeStore().getState()
    expect(s.mode).toBe('a')
    expect(s.session).toBe(0)
  })
})

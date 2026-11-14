// @vitest-environment node
import { vi } from 'vitest'

vi.mock('electron', () => ({ app: {}, dialog: {} }))
vi.mock('../paths', () => ({ isTestRun: false }))

const { createCrashTracker } = await import('./crashRecovery')

describe('createCrashTracker', () => {
  it('reloads until 3 crashes fall within 60 s', () => {
    const t = createCrashTracker()
    expect(t.record(0)).toBe('reload')
    expect(t.record(10_000)).toBe('reload')
    expect(t.record(59_000)).toBe('give-up')
  })

  it('crashes spread out over more than a minute keep reloading', () => {
    const t = createCrashTracker()
    expect(t.record(0)).toBe('reload')
    expect(t.record(40_000)).toBe('reload')
    expect(t.record(70_000)).toBe('reload') // the first one aged out
    expect(t.record(200_000)).toBe('reload')
  })

  it('reset starts counting again (after "Try again")', () => {
    const t = createCrashTracker()
    t.record(0)
    t.record(1)
    expect(t.record(2)).toBe('give-up')
    t.reset()
    expect(t.record(3)).toBe('reload')
  })
})

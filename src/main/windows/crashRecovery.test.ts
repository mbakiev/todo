// @vitest-environment node
import { vi } from 'vitest'

vi.mock('electron', () => ({ app: {}, dialog: {} }))
vi.mock('../paths', () => ({ isTestRun: false }))

const { createCrashTracker, createHangWatch } = await import('./crashRecovery')

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

describe('createHangWatch (Wait / Reload prompt)', () => {
  function setup() {
    vi.useFakeTimers()
    const prompts: Array<{ resolve(a: 'wait' | 'reload'): void; closed: boolean }> = []
    const reload = vi.fn()
    const watch = createHangWatch({
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
      canPrompt: () => true,
      showPrompt: () => {
        let resolve: (a: 'wait' | 'reload') => void = () => {}
        const answer = new Promise<'wait' | 'reload'>((r) => (resolve = r))
        const p = { resolve: (a: 'wait' | 'reload') => resolve(a), closed: false }
        prompts.push(p)
        return {
          answer,
          close: () => {
            p.closed = true
            resolve('wait')
          },
        }
      },
      reload,
    })
    return { watch, prompts, reload }
  }
  afterEach(() => vi.useRealTimers())

  it('prompts only after 10 s of continuous unresponsiveness', () => {
    const { watch, prompts } = setup()
    watch.unresponsive()
    vi.advanceTimersByTime(9_999)
    expect(prompts).toHaveLength(0)
    vi.advanceTimersByTime(1)
    expect(prompts).toHaveLength(1)
  })

  it('a busy spell that recovers within 10 s never prompts', () => {
    const { watch, prompts } = setup()
    watch.unresponsive()
    vi.advanceTimersByTime(8_000)
    watch.responsive()
    vi.advanceTimersByTime(60_000)
    expect(prompts).toHaveLength(0)
  })

  it('dismisses the prompt by itself when the window recovers', async () => {
    const { watch, prompts, reload } = setup()
    watch.unresponsive()
    vi.advanceTimersByTime(10_000)
    watch.responsive()
    expect(prompts[0]?.closed).toBe(true)
    await Promise.resolve()
    expect(reload).not.toHaveBeenCalled()
  })

  it('never shows twice for the same freeze (Wait keeps it quiet until it recovers)', async () => {
    const { watch, prompts } = setup()
    watch.unresponsive()
    vi.advanceTimersByTime(10_000)
    prompts[0]?.resolve('wait')
    await Promise.resolve()
    watch.unresponsive() // Electron may report the same hang again
    vi.advanceTimersByTime(60_000)
    expect(prompts).toHaveLength(1)
    // A new freeze after recovering is a new prompt.
    watch.responsive()
    watch.unresponsive()
    vi.advanceTimersByTime(10_000)
    expect(prompts).toHaveLength(2)
  })

  it('Reload reloads the window', async () => {
    const { watch, prompts, reload } = setup()
    watch.unresponsive()
    vi.advanceTimersByTime(10_000)
    prompts[0]?.resolve('reload')
    await Promise.resolve()
    await Promise.resolve()
    expect(reload).toHaveBeenCalledTimes(1)
  })
})

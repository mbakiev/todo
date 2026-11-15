// @vitest-environment node
import { createQuitGate } from './quitGate'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

function setup() {
  const flush = deferred()
  const deps = {
    flush: vi.fn(() => flush.promise),
    quit: vi.fn(),
    finalize: vi.fn(),
  }
  return { gate: createQuitGate(deps), deps, flush }
}

describe('quit gate', () => {
  it('holds the first quit until the renderer flushed, then quits for real', async () => {
    const { gate, deps, flush } = setup()
    expect(gate.beforeQuit()).toBe(true)
    expect(deps.flush).toHaveBeenCalledTimes(1)
    expect(deps.quit).not.toHaveBeenCalled()
    flush.resolve()
    await flush.promise
    await Promise.resolve()
    expect(deps.quit).toHaveBeenCalledTimes(1)
    // The re-issued quit passes.
    expect(gate.beforeQuit()).toBe(false)
    gate.finalize()
    expect(deps.finalize).toHaveBeenCalledTimes(1)
  })

  it('a second quit request during the wait is held too (the DB cannot close early)', async () => {
    const { gate, deps, flush } = setup()
    expect(gate.beforeQuit()).toBe(true)
    expect(gate.beforeQuit()).toBe(true) // e.g. Cmd+Q pressed twice, or tray Quit + SIGTERM
    expect(gate.beforeQuit()).toBe(true)
    expect(deps.flush).toHaveBeenCalledTimes(1)
    expect(deps.finalize).not.toHaveBeenCalled()
    flush.resolve()
    await flush.promise
    await Promise.resolve()
    expect(deps.quit).toHaveBeenCalledTimes(1)
    expect(gate.beforeQuit()).toBe(false)
  })

  it('Windows session end: flush starts on query-session-end, finalize runs once', async () => {
    const { gate, deps, flush } = setup()
    gate.sessionEnding()
    gate.sessionEnding()
    expect(deps.flush).toHaveBeenCalledTimes(1)
    expect(deps.quit).not.toHaveBeenCalled()
    flush.resolve()
    await flush.promise
    await Promise.resolve()
    expect(gate.state).toBe('flushed')
    gate.finalize()
    gate.finalize()
    expect(deps.finalize).toHaveBeenCalledTimes(1)
  })

  it('Windows session end: session-end during the flush finalizes only once it settled', async () => {
    const { gate, deps, flush } = setup()
    gate.sessionEnding()
    gate.sessionEnded() // WM_ENDSESSION right behind WM_QUERYENDSESSION
    expect(deps.finalize).not.toHaveBeenCalled() // the DB stays open for the renderer's writes
    flush.resolve()
    await flush.promise
    await Promise.resolve()
    expect(deps.finalize).toHaveBeenCalledTimes(1)
    expect(gate.state).toBe('finalized')
    expect(deps.quit).not.toHaveBeenCalled()
    gate.sessionEnded()
    expect(deps.finalize).toHaveBeenCalledTimes(1)
  })

  it('Windows session end: session-end with nothing left to flush finalizes at once', () => {
    const { gate, deps } = setup()
    gate.sessionEnded()
    expect(deps.flush).not.toHaveBeenCalled()
    expect(deps.finalize).toHaveBeenCalledTimes(1)
  })

  it('a quit after the session flush started waits for the same flush', async () => {
    const { gate, deps, flush } = setup()
    gate.sessionEnding()
    expect(gate.beforeQuit()).toBe(true)
    flush.resolve()
    await flush.promise
    await Promise.resolve()
    expect(deps.flush).toHaveBeenCalledTimes(1)
    expect(deps.quit).toHaveBeenCalledTimes(1) // the held quit is re-issued
    expect(gate.beforeQuit()).toBe(false)
  })
})

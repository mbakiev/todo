import { EventEmitter } from 'node:events'
import { createSuspensionGuard, type SuspenderContents } from './shortcutSuspension'

const asContents = (e: EventEmitter): SuspenderContents => e as unknown as SuspenderContents

function setup() {
  const release = vi.fn()
  const guard = createSuspensionGuard(release)
  const wc = new EventEmitter()
  guard.suspendedBy(asContents(wc))
  return { release, guard, wc }
}

describe('global shortcut suspension never outlives the page that asked for it', () => {
  it.each(['destroyed', 'render-process-gone'])('resumes when the webContents is %s', (ev) => {
    const { release, wc } = setup()
    wc.emit(ev)
    expect(release).toHaveBeenCalledTimes(1)
    wc.emit(ev)
    expect(release).toHaveBeenCalledTimes(1) // listeners removed
  })

  it('resumes on a reload / navigation of the main frame, not on in-page or subframe ones', () => {
    const { release, wc } = setup()
    wc.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true })
    wc.emit('did-start-navigation', { isMainFrame: false, isSameDocument: false })
    expect(release).not.toHaveBeenCalled()
    wc.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false })
    expect(release).toHaveBeenCalledTimes(1)
  })

  it('stops watching after a normal resume', () => {
    const { release, guard, wc } = setup()
    guard.resumed()
    wc.emit('destroyed')
    expect(release).not.toHaveBeenCalled()
    expect(wc.listenerCount('destroyed')).toBe(0)
  })

  it('only the latest suspender is watched', () => {
    const { release, guard, wc } = setup()
    const other = new EventEmitter()
    guard.suspendedBy(asContents(other))
    wc.emit('destroyed')
    expect(release).not.toHaveBeenCalled()
    other.emit('destroyed')
    expect(release).toHaveBeenCalledTimes(1)
  })
})

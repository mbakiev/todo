import type { BrowserWindow } from 'electron'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IPC } from '@shared/ipc'
import { rendererFlushed, requestRendererFlush } from './rendererFlush'

function fakeWindow(opts: { loading?: boolean } = {}) {
  const send = vi.fn()
  const win = {
    isDestroyed: () => false,
    webContents: { isDestroyed: () => false, isLoading: () => opts.loading ?? false, send },
  }
  return { win: win as unknown as BrowserWindow, send }
}

describe('requestRendererFlush', () => {
  afterEach(() => vi.useRealTimers())

  it('resolves "flushed" when the renderer answers with the request id', async () => {
    const { win, send } = fakeWindow()
    const p = requestRendererFlush(win, 1000)
    expect(send).toHaveBeenCalledWith(IPC.events.flushRequested, expect.any(Number))
    rendererFlushed(send.mock.calls[0]?.[1] as number)
    await expect(p).resolves.toBe('flushed')
  })

  it('ignores answers for other requests and times out', async () => {
    vi.useFakeTimers()
    const { win, send } = fakeWindow()
    const p = requestRendererFlush(win, 1000)
    rendererFlushed((send.mock.calls[0]?.[1] as number) + 100)
    vi.advanceTimersByTime(1000)
    await expect(p).resolves.toBe('timeout')
  })

  it('skips windows that cannot answer', async () => {
    await expect(requestRendererFlush(null)).resolves.toBe('skipped')
    const { win, send } = fakeWindow({ loading: true })
    await expect(requestRendererFlush(win)).resolves.toBe('skipped')
    expect(send).not.toHaveBeenCalled()
  })
})

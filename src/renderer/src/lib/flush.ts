// Renderer half of the hide/quit flush handshake (main: windows/rendererFlush.ts). Components
// with debounced edits register a flusher; on `flushRequested` every flusher runs, then we wait
// for the resulting writes to reach main before answering.
import { useTasksStore } from '@/stores/tasksStore'
import { api } from './api'

const flushers = new Set<() => void | Promise<unknown>>()

/**
 * Registers a "save pending edits now" callback; it may return a promise that settles once
 * its saves were answered. Returns an unregister function.
 */
export function registerFlusher(flush: () => void | Promise<unknown>): () => void {
  flushers.add(flush)
  return () => {
    flushers.delete(flush)
  }
}

/** Runs every flusher and resolves once their writes have been acknowledged by main. */
export async function flushPendingEdits(): Promise<void> {
  const waits: Promise<unknown>[] = []
  for (const flush of flushers) {
    try {
      const r = flush()
      if (r) waits.push(r)
    } catch (err) {
      console.error('flush failed', err)
    }
  }
  // Includes the drafts' own failure handling (e.g. keeping unsaved text in localStorage).
  await Promise.allSettled(waits)
  await useTasksStore.getState().whenIdle()
}

export function installFlushHandshake(): void {
  api().on.flushRequested((requestId) => {
    void flushPendingEdits().finally(() => void api().app.flushDone(requestId))
  })
}

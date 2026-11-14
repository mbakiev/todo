// Renderer half of the hide/quit flush handshake (main: windows/rendererFlush.ts). Components
// with debounced edits register a flusher; on `flushRequested` every flusher runs, then we wait
// for the resulting writes to reach main before answering.
import { useTasksStore } from '@/stores/tasksStore'
import { api } from './api'

const flushers = new Set<() => void>()

/** Registers a synchronous "save pending edits now" callback. Returns an unregister function. */
export function registerFlusher(flush: () => void): () => void {
  flushers.add(flush)
  return () => {
    flushers.delete(flush)
  }
}

/** Runs every flusher and resolves once their writes have been acknowledged by main. */
export async function flushPendingEdits(): Promise<void> {
  for (const flush of flushers) {
    try {
      flush()
    } catch (err) {
      console.error('flush failed', err)
    }
  }
  await useTasksStore.getState().whenIdle()
}

export function installFlushHandshake(): void {
  api().on.flushRequested((requestId) => {
    void flushPendingEdits().finally(() => void api().app.flushDone(requestId))
  })
}

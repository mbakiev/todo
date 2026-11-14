import type { Api } from '@shared/ipc'

/** The preload bridge. Wrapped in a getter so tests can install a mock on `window.api`. */
export function api(): Api {
  return window.api
}

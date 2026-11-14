/// <reference types="vite/client" />
import type { Api } from '@shared/ipc'

declare global {
  interface Window {
    /** Typed bridge exposed by src/preload/index.ts. The renderer's only door to main. */
    api: Api
  }
}

export {}

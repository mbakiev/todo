import { NOT_IMPLEMENTED } from '@shared/ipc'

/** Rejection used by phase-1 stubs; replace the calling body with a real implementation. */
export function notImplemented(what: string): Error {
  return new Error(`${NOT_IMPLEMENTED}: ${what}`)
}

/**
 * User-facing message from an IPC rejection. Electron prefixes errors with
 * "Error invoking remote method 'channel': Error: " — strip that.
 */
export function errorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  return (
    raw.replace(/^Error invoking remote method '[^']+':\s*(?:\w*Error:\s*)?/, '').trim() ||
    'Something went wrong'
  )
}

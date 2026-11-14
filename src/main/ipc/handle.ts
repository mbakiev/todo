import { ipcMain } from 'electron'
import { z } from 'zod'

/**
 * Registers an `ipcMain.handle` whose arguments are validated with a zod tuple schema.
 * Validation errors are rethrown with a readable message (the renderer shows it in a toast).
 */
export function handle<A extends z.ZodTuple, R>(
  channel: string,
  args: A,
  fn: (...parsed: z.output<A>) => R | Promise<R>,
): void {
  ipcMain.removeHandler(channel)
  ipcMain.handle(channel, async (_event, ...raw: unknown[]) => {
    const parsed = args.safeParse(raw)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      const where = issue && issue.path.length > 0 ? ` (${issue.path.join('.')})` : ''
      throw new Error(`Invalid input${where}: ${issue?.message ?? 'validation failed'}`)
    }
    return fn(...(parsed.data as z.output<A>))
  })
}

export const noArgs = z.tuple([])

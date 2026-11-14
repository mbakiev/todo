import { ipcMain } from 'electron'
import { z } from 'zod'
import { describeValidationIssue } from '@shared/validationMessage'

/**
 * Registers an `ipcMain.handle` whose arguments are validated with a zod tuple schema.
 * Validation errors are rethrown as one plain sentence (describeValidationIssue), which the
 * renderer's errorMessage() shows in the toast.
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
      // Logged in full for debugging; the user sees one plain sentence.
      console.warn(`[ipc] invalid input for ${channel}`, parsed.error.issues)
      throw new Error(describeValidationIssue(issue))
    }
    return fn(...(parsed.data as z.output<A>))
  })
}

export const noArgs = z.tuple([])

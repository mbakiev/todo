export type RepoErrorCode = 'not_found' | 'validation' | 'conflict'

/** Errors thrown by repositories; the message is safe to show to the user. */
export class RepoError extends Error {
  constructor(
    readonly code: RepoErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'RepoError'
  }
}

export const notFound = (what: string, id: string): RepoError =>
  new RepoError('not_found', `${what} not found: ${id}`)

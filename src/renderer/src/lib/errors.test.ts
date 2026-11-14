import { errorMessage } from './errors'

describe('errorMessage', () => {
  it("shows the main-process sentence without Electron's IPC prefix", () => {
    const err = new Error(
      "Error invoking remote method 'tasks:create': Error: The tag name is too long (at most 50 characters).",
    )
    expect(errorMessage(err)).toBe('The tag name is too long (at most 50 characters).')
    expect(errorMessage(new Error(''))).toBe('Something went wrong')
  })
})

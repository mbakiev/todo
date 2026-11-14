import {
  clearUnsavedDraft,
  loadUnsavedDraft,
  pruneUnsavedDrafts,
  recoverableDraft,
  storeUnsavedDraft,
  type UnsavedDraft,
} from './draftRecovery'

const draft = (over: Partial<UnsavedDraft> = {}): UnsavedDraft => ({
  taskId: 't1',
  field: 'description',
  text: 'typed but not saved',
  taskUpdatedAt: 100,
  storedAt: 200,
  ...over,
})

beforeEach(() => localStorage.clear())

describe('unsaved draft storage', () => {
  it('stores, loads and clears per task and field', () => {
    storeUnsavedDraft(localStorage, draft())
    storeUnsavedDraft(localStorage, draft({ field: 'title', text: 'a title' }))
    expect(loadUnsavedDraft(localStorage, 't1', 'description')?.text).toBe('typed but not saved')
    expect(loadUnsavedDraft(localStorage, 't1', 'title')?.text).toBe('a title')
    expect(loadUnsavedDraft(localStorage, 't2', 'title')).toBeNull()
    clearUnsavedDraft(localStorage, 't1', 'description')
    expect(loadUnsavedDraft(localStorage, 't1', 'description')).toBeNull()
    expect(loadUnsavedDraft(localStorage, 't1', 'title')).not.toBeNull()
  })

  it('treats unreadable entries as absent and works without storage', () => {
    localStorage.setItem('martin-todos.unsavedDraft.t1.title', '{not json')
    expect(loadUnsavedDraft(localStorage, 't1', 'title')).toBeNull()
    expect(loadUnsavedDraft(null, 't1', 'title')).toBeNull()
    expect(() => storeUnsavedDraft(null, draft())).not.toThrow()
  })

  it('prunes drafts of missing tasks older than 30 days (and unreadable ones), keeps the rest', () => {
    const DAY = 24 * 60 * 60 * 1000
    const now = 100 * DAY
    storeUnsavedDraft(localStorage, draft({ taskId: 'alive', storedAt: now - 90 * DAY }))
    storeUnsavedDraft(localStorage, draft({ taskId: 'gone', storedAt: now - 31 * DAY }))
    localStorage.setItem('martin-todos.unsavedDraft.x.title', 'garbage')
    localStorage.setItem('martin-todos.viewPrefs.list', '{"keep":true}')
    pruneUnsavedDrafts(localStorage, new Set(['alive']), now)
    expect(loadUnsavedDraft(localStorage, 'alive', 'description')).not.toBeNull()
    expect(loadUnsavedDraft(localStorage, 'gone', 'description')).toBeNull()
    expect(localStorage.getItem('martin-todos.unsavedDraft.x.title')).toBeNull()
    expect(localStorage.getItem('martin-todos.viewPrefs.list')).not.toBeNull()
  })
})

describe('a draft of a deleted task survives a restart (Undo after relaunch)', () => {
  it("keeps a missing task's draft younger than 30 days", () => {
    const DAY = 24 * 60 * 60 * 1000
    const now = 100 * DAY
    storeUnsavedDraft(localStorage, draft({ taskId: 'deleted', storedAt: now - 29 * DAY }))
    pruneUnsavedDrafts(localStorage, new Set(), now) // startup: the task is soft-deleted
    // …then Undo brings the task back, and its text is still on offer.
    expect(
      recoverableDraft(localStorage, { id: 'deleted', updatedAt: 100 }, 'description', ''),
    ).toEqual({ text: 'typed but not saved', changedSince: false })
  })
})

describe('recoverableDraft', () => {
  it('offers stored text that differs from what is saved, saying whether the task changed since', () => {
    storeUnsavedDraft(localStorage, draft())
    expect(
      recoverableDraft(localStorage, { id: 't1', updatedAt: 100 }, 'description', 'old'),
    ).toEqual({ text: 'typed but not saved', changedSince: false })
    expect(
      recoverableDraft(localStorage, { id: 't1', updatedAt: 150 }, 'description', 'old')
        ?.changedSince,
    ).toBe(true)
  })

  it('drops an obsolete draft whose text is already saved', () => {
    storeUnsavedDraft(localStorage, draft())
    expect(
      recoverableDraft(
        localStorage,
        { id: 't1', updatedAt: 300 },
        'description',
        'typed but not saved',
      ),
    ).toBeNull()
    expect(loadUnsavedDraft(localStorage, 't1', 'description')).toBeNull()
  })
})

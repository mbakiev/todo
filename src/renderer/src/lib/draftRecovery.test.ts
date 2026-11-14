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

  it('prunes drafts of tasks that no longer exist (and unreadable ones), keeps the rest', () => {
    storeUnsavedDraft(localStorage, draft({ taskId: 'alive' }))
    storeUnsavedDraft(localStorage, draft({ taskId: 'gone' }))
    localStorage.setItem('martin-todos.unsavedDraft.x.title', 'garbage')
    localStorage.setItem('martin-todos.viewPrefs.list', '{"keep":true}')
    pruneUnsavedDrafts(localStorage, new Set(['alive']))
    expect(loadUnsavedDraft(localStorage, 'alive', 'description')).not.toBeNull()
    expect(loadUnsavedDraft(localStorage, 'gone', 'description')).toBeNull()
    expect(localStorage.getItem('martin-todos.unsavedDraft.x.title')).toBeNull()
    expect(localStorage.getItem('martin-todos.viewPrefs.list')).not.toBeNull()
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

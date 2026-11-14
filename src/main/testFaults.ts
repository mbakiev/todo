// Faults e2e tests can switch on (only through the `__martinTodosTest` hooks, which exist only
// with MARTIN_TODOS_E2E=1). Inert in every normal run.
export const testFaults = {
  /** tasks.update rejects, as if the write failed (disk full, locked DB…). */
  failTaskUpdates: false,
}

// Guards the unit-test time zone that vitest.config.mts pins (TZ=America/New_York unless
// overridden). Date/DST tests elsewhere silently test nothing if the zone didn't take
// effect, e.g. on a Windows runner whose system zone is UTC.
describe('unit-test time zone', () => {
  it.runIf(process.env['TZ'] === 'America/New_York')('is really America/New_York', () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('America/New_York')
    // EST in January (UTC-5), EDT in July (UTC-4).
    expect(new Date(2026, 0, 15).getTimezoneOffset()).toBe(300)
    expect(new Date(2026, 6, 15).getTimezoneOffset()).toBe(240)
  })
})

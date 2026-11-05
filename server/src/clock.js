/** The only place the app reads the current time. Tests inject a fixed or movable clock. */
export const systemClock = { now: () => new Date() };

export function fixedClock(iso) {
  let t = new Date(iso).getTime();
  return {
    now: () => new Date(t),
    set(iso2) { t = new Date(iso2).getTime(); },
    advanceHours(h) { t += h * 3600_000; },
    advanceDays(d) { t += d * 86_400_000; },
  };
}

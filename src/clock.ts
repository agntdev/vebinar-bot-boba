// Injectable clock — the single time seam for the bot. Route every schedule,
// cutoff, "today", expiry, and late/on-time decision through `now()` instead of
// calling `Date.now()` / `new Date()` inline, so time-based behavior stays
// testable. (AGENTS.md — TIME / testable clock.)
//
// In production this returns wall-clock time. Tests can override it with
// `setClock(() => fixedMs)` to drive a scheduled/cutoff feature deterministically.

export type Clock = () => number;

let clock: Clock = () => Date.now();

/** Current time in epoch milliseconds. Override via `setClock` in tests. */
export function now(): number {
  return clock();
}

/** Override the clock (test seam). Pass no argument to restore real time. */
export function setClock(fn?: Clock): void {
  clock = fn ?? (() => Date.now());
}

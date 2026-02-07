/**
 * Safe Timer Utilities
 *
 * Drop-in replacements for setTimeout/setInterval that automatically
 * call .unref() so timers never keep the Node/Bun event loop alive.
 *
 * Rule: NEVER use raw setTimeout/setInterval in this codebase.
 * Always use safeTimeout/safeInterval instead.
 */

type TimerCallback = () => void;

/**
 * setTimeout that won't keep the process alive.
 * Returns the timer ID for clearTimeout().
 */
export function safeTimeout(fn: TimerCallback, ms: number): ReturnType<typeof setTimeout> {
  const timer = setTimeout(fn, ms);
  if (typeof timer === "object" && "unref" in timer) timer.unref();
  return timer;
}

/**
 * setInterval that won't keep the process alive.
 * Returns the timer ID for clearInterval().
 */
export function safeInterval(fn: TimerCallback, ms: number): ReturnType<typeof setInterval> {
  const timer = setInterval(fn, ms);
  if (typeof timer === "object" && "unref" in timer) timer.unref();
  return timer;
}

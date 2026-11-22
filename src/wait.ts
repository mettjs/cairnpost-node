import { bare } from "./bare.ts";

/**
 * The longest wait an answer is believed to ask for, in seconds: about
 * 31 years. No server means more, and it is the most the Retry-After
 * header can say in the nine digits read of it.
 */
export const longestWaitSeconds = 999_999_999;

/**
 * How long a Retry-After header asks to wait, in milliseconds; undefined
 * when it does not say. It is a wait in two forms only: 1 to 9 digits,
 * which are seconds and what CairnPost writes, and a date exactly as HTTP
 * writes one now ("Sun, 06 Nov 1994 08:49:37 GMT"), which a proxy may
 * write and is the time to wait until. A sign, a fraction, an older form
 * of a date or a date that never comes is no wait: the Go and Python
 * clients read the same.
 */
export function waitOf(retryAfter: string | null, now: number = Date.now()): number | undefined {
  const after = bare(retryAfter ?? "");
  if (/^[0-9]{1,9}$/.test(after)) return believed(Number(after));
  // Date.parse alone takes much else, a 31 Feb as a day in March and an
  // hour 24 among it: a date is one when the time it names is written
  // back the same.
  const at = Date.parse(after);
  if (Number.isNaN(at) || new Date(at).toUTCString() !== after) return undefined;
  // A part of a second is a whole one: a caller never comes back early.
  return believed(Math.ceil((at - now) / 1000));
}

/**
 * A wait said in seconds, in milliseconds, when it is one: a whole number
 * from 1 to the longest, however it was written (30, 30.0, 3e1).
 * Anything else is no wait.
 */
export function believed(seconds: unknown): number | undefined {
  return typeof seconds === "number" && Number.isInteger(seconds) && seconds >= 1 && seconds <= longestWaitSeconds ? seconds * 1000 : undefined;
}

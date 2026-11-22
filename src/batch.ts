import { type Email, readSent, type Sent } from "./email.ts";
import { isKnown } from "./codes.ts";
import type { CairnPostError } from "./errors.ts";
import { problemFrom } from "./problem.ts";
import { fields, has, list, Misshapen } from "./read.ts";
import { believed } from "./wait.ts";

/** Several emails to send in one request. */
export interface Batch {
  emails: Email[];
  /**
   * Makes the batch safe to send again as it was: the server remembers
   * each email under the key and its place, so a second try sends only
   * what did not go. Send the same emails in the same order. An email's
   * own `idempotencyKey` is not used in a batch.
   */
  idempotencyKey?: string | undefined;
}

/**
 * What became of one email of a batch: `sent`, or `error`, which is the
 * `CairnPostError` a send of this email alone would have thrown:
 * `retryable` and `mayHaveSent` read it the same way.
 */
export type BatchResult = { sent: Sent; error?: undefined } | { sent?: undefined; error: CairnPostError };

/** Counts the emails of a batch that did not go. */
export function failed(results: BatchResult[]): number {
  return results.filter((r) => r.error !== undefined).length;
}

/**
 * Reads a batch's answer. One that does not answer for each email asked
 * is not CairnPost's: which emails went is not known.
 */
export function readBatch(v: unknown, later: boolean[]): BatchResult[] {
  const results = list(has(fields(v), "data"), "data", (item) => fields(item));
  if (results.length !== later.length) throw new Misshapen();
  return results.map((o, i): BatchResult => {
    if (o["error"] === undefined || o["error"] === null) {
      return { sent: readSent(o, later[i] === true) };
    }
    const e = fields(o["error"]);
    const status = e["statusCode"];
    if (typeof status !== "number" || !Number.isInteger(status) || status < 400 || status > 599) throw new Misshapen();
    // Under a name this client does not know, only the status is
    // believed, as for an answer that is not CairnPost's.
    return { error: problemFrom(status, e, isKnown(e["name"]) ? believed(e["retry_after"]) : undefined) };
  });
}

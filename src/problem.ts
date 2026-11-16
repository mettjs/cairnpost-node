import { isKnown } from "./codes.ts";
import { CairnPostError } from "./errors.ts";

/**
 * Reads an error answer. Only CairnPost's own fields are kept, and only
 * under a name of CairnPost's: anything else at that address could say
 * back what it was sent.
 */
export function problemOf(status: number, raw: Uint8Array, retryAfter: string | null): CairnPostError {
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    body = undefined;
  }
  return problemFrom(status, body, waitOf(retryAfter));
}

/** A problem from an error as CairnPost writes one, wherever it was said. */
export function problemFrom(status: number, body: unknown, retryAfterMs: number | undefined): CairnPostError {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return new CairnPostError({ status, retryAfterMs });
  const said = body as Record<string, unknown>;
  const name = said["name"];
  if (!isKnown(name)) return new CairnPostError({ status, retryAfterMs });
  const text = (key: string) => (typeof said[key] === "string" ? (said[key] as string) : undefined);
  return new CairnPostError({ status, code: name, detail: text("message"), emailId: text("id"), retryAfterMs });
}

/**
 * How long an answer asks to wait, in milliseconds; undefined when it
 * does not say. Retry-After is seconds from CairnPost, and may be a date
 * from a proxy.
 */
export function waitOf(retryAfter: string | null): number | undefined {
  const after = (retryAfter ?? "").trim();
  if (/^\d{1,9}$/.test(after)) return Number(after) > 0 ? Number(after) * 1000 : undefined;
  // Only the form HTTP writes a date in: Date.parse alone takes much else.
  if (!/^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(after)) return undefined;
  const ms = Date.parse(after) - Date.now();
  return ms > 0 ? Math.round(ms / 1000) * 1000 : undefined;
}

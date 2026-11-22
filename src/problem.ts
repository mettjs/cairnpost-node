import { isKnown } from "./codes.ts";
import { CairnPostError } from "./errors.ts";
import { waitOf } from "./wait.ts";

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

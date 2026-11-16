import { createHmac, timingSafeEqual } from "node:crypto";
import type { WebhookEvent } from "./events.ts";
import { readEvent } from "./payload.ts";

/** How far a webhook's timestamp may be from now, in milliseconds. */
export const defaultToleranceMs = 5 * 60 * 1000;

/** Why a webhook was refused. */
export type WebhookRefusal =
  /** The signing secret is not one CairnPost gives. */
  | "secret"
  /** The request lacks the webhook's id, timestamp or signature headers. */
  | "unsigned"
  /**
   * No signature matches. The request is not from CairnPost, was changed
   * on the way, was signed for another endpoint, or the endpoint's secret
   * was changed and this one no longer signs.
   */
  | "signature"
  /** The timestamp is too far from now. A webhook caught on the way and replayed later is refused by this. */
  | "stale"
  /** Signed by CairnPost, but not a webhook this client can read. */
  | "payload";

const refusals: Record<WebhookRefusal, string> = {
  secret: "the signing secret must be the whsec_ value the server gave for the endpoint",
  unsigned: "the webhook's signature headers are missing",
  signature: "the webhook's signature does not match",
  stale: "the webhook's timestamp is too far from now",
  payload: "the webhook's body could not be read",
};

/** A webhook that must not be trusted: answer it 400 or 401. */
export class WebhookError extends Error {
  override readonly name = "WebhookError";
  readonly reason: WebhookRefusal;

  constructor(reason: WebhookRefusal) {
    super("cairnpost: " + refusals[reason]);
    this.reason = reason;
  }
}

/** The headers of a request, as `fetch` or `node:http` gives them. */
export type RequestHeaders = { get(name: string): string | null } | Record<string, string | string[] | undefined>;

export interface VerifierOptions {
  /** How far the timestamp may be from now, either way. `defaultToleranceMs` when left out. */
  toleranceMs?: number | undefined;
  /** The clock, in milliseconds; `Date.now` when left out. */
  now?: (() => number) | undefined;
}

// Base64 as the standard writes it: both runtimes' decoders take much else.
const base64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function decode(encoded: string): Buffer | undefined {
  return encoded !== "" && base64.test(encoded) ? Buffer.from(encoded, "base64") : undefined;
}

/** Checks that a webhook is CairnPost's. */
export class Verifier {
  readonly #key: Buffer;
  readonly #toleranceMs: number;
  readonly #now: () => number;

  /**
   * Makes a verifier for an endpoint's signing secret: the "whsec_..."
   * value `webhooks.create` answered or, once the secret was changed, the
   * one `webhooks.rotateSecret` did. Each is said only once.
   */
  constructor(secret: string, options: VerifierOptions = {}) {
    const trimmed = typeof secret === "string" ? secret.trim() : "";
    const key = trimmed.startsWith("whsec_") ? decode(trimmed.slice("whsec_".length)) : undefined;
    if (key === undefined) throw new WebhookError("secret");
    this.#key = key;
    this.#toleranceMs = options.toleranceMs && options.toleranceMs > 0 ? options.toleranceMs : defaultToleranceMs;
    this.#now = options.now ?? Date.now;
  }

  /**
   * Checks a webhook and reads it. `body` must be the request's body
   * exactly as it arrived, as bytes or as the text they are: read it
   * once, verify, and only then use it. A `WebhookError` means the
   * request must not be trusted. A `TypeError` means the call itself is
   * wrong (a body already parsed, say), whatever the request was.
   *
   * In the event answered, `email` is set for every type that starts with
   * "email." but `email.received`, and `email.bounce` for
   * `email.bounced`; `suppression` is set for `address.suppressed` and
   * `received` for `email.received`.
   *
   * CairnPost signs as Standard Webhooks and Svix do, and sends the
   * headers under both names; either set is accepted.
   */
  verify(headers: RequestHeaders, body: string | Uint8Array | ArrayBuffer): WebhookEvent {
    // A mistake of the caller's is said as one, not as a forged webhook.
    if (typeof headers !== "object" || headers === null) {
      throw new TypeError("cairnpost: verify takes the request's headers as its first argument");
    }
    const raw = bytesOf(body);
    const { id, stamp, signatures } = signed(headers);
    if (id === "" || stamp === "" || signatures === "" || !/^\d{1,15}$/.test(stamp)) throw new WebhookError("unsigned");
    const want = createHmac("sha256", this.#key).update(`${id}.${stamp}.`).update(raw).digest();
    let matched = false;
    for (const candidate of signatures.split(/\s+/)) {
      const got = candidate.startsWith("v1,") ? decode(candidate.slice(3)) : undefined;
      if (got !== undefined && got.length === want.length && timingSafeEqual(got, want)) matched = true;
    }
    if (!matched) throw new WebhookError("signature");
    // The time is checked after the signature: only a signed timestamp
    // means anything.
    if (Math.abs(this.#now() - Number(stamp) * 1000) > this.#toleranceMs) throw new WebhookError("stale");
    try {
      return readEvent(id, JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)));
    } catch {
      // Whatever went wrong, it is a body that cannot be read.
      throw new WebhookError("payload");
    }
  }
}

function bytesOf(body: unknown): Buffer {
  if (typeof body === "string") return Buffer.from(body, "utf8");
  if (body instanceof Uint8Array) return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  throw new TypeError("cairnpost: verify takes the request's body as it arrived, as text or bytes: not parsed, and not left out");
}

/** Reads the signature headers under whichever names they came. */
function signed(headers: RequestHeaders): { id: string; stamp: string; signatures: string } {
  let found = { id: "", stamp: "", signatures: "" };
  for (const prefix of ["webhook-", "svix-"]) {
    found = { id: header(headers, prefix + "id"), stamp: header(headers, prefix + "timestamp"), signatures: header(headers, prefix + "signature") };
    if (found.id !== "" && found.stamp !== "" && found.signatures !== "") break;
  }
  return found;
}

function header(headers: RequestHeaders, name: string): string {
  if (typeof (headers as { get?: unknown }).get === "function") {
    return ((headers as { get(n: string): string | null }).get(name) ?? "").trim();
  }
  for (const [key, value] of Object.entries(headers as Record<string, string | string[] | undefined>)) {
    if (key.toLowerCase() !== name) continue;
    const first = Array.isArray(value) ? value[0] : value;
    return typeof first === "string" ? first.trim() : "";
  }
  return "";
}

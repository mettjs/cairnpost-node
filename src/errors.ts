import { ErrorCode } from "./codes.ts";

/** What a `CairnPostError` is made of. */
export interface Problem {
  status: number;
  code?: ErrorCode | undefined;
  detail?: string | undefined;
  emailId?: string | undefined;
  retryAfterMs?: number | undefined;
}

/**
 * CairnPost saying no. `status` and `code` say what to do:
 *
 * - 422: the request is at fault and will never succeed. Do not retry.
 *   Under `sender_domain_not_ready` no email from that domain will be
 *   sent until the domain is set up with the mail provider.
 * - 409 `invalid_idempotent_request`: the key was used for another email,
 *   which was sent. Do not retry.
 * - 409 `concurrent_idempotent_requests`, 408 `request_incomplete`, 429,
 *   503: nothing was sent. Try again, after `retryAfterMs` when it is set.
 * - 502 `upstream_unknown`, and any 5xx or 408 that is not CairnPost's own: the
 *   email may have gone. Try again with the same idempotency key, and
 *   only with it. `mayHaveSent` says which errors these are.
 */
export class CairnPostError extends Error {
  override readonly name = "CairnPostError";
  /** The HTTP status of the answer. */
  readonly status: number;
  /** One of `ErrorCode`; undefined when the answer was not CairnPost's own (a proxy in between, say). */
  readonly code: ErrorCode | undefined;
  /**
   * CairnPost's sentence for a person: what is wrong and what to do. It
   * never holds the email's subject or body; it may name the field, or
   * the header, that was refused. Undefined when the answer was not
   * CairnPost's own, whatever that answer said.
   */
  readonly detail: string | undefined;
  /**
   * The email's id when the send got far enough to have one: `emails.get`
   * then says what became of it. With `recipient_suppressed` it is an
   * earlier try under the same idempotency key that may have gone.
   */
  readonly emailId: string | undefined;
  /**
   * How long the server asked to wait, in milliseconds; undefined when it
   * did not say. Whole seconds, at least one and never more than about
   * 31 years: a wait outside that is read as none. A timer holds at
   * most 2,147,483,647 ms (about 24.8 days) and fires at once when given
   * more, so sleep a longer wait in parts.
   */
  readonly retryAfterMs: number | undefined;

  constructor(p: Problem) {
    super(sentence(p));
    this.status = p.status;
    this.code = p.code;
    this.detail = p.detail || undefined;
    this.emailId = p.emailId || undefined;
    this.retryAfterMs = p.retryAfterMs || undefined;
  }

  /**
   * Says that the same request may succeed later. It does not say that
   * nothing was sent: ask `mayHaveSent` first, and when that is true
   * retry only with the same idempotency key.
   */
  get retryable(): boolean {
    // A 408 is a request that did not arrive whole in time; mayHaveSent
    // says what one from something in between leaves open.
    if (this.code === ErrorCode.idempotentInFlight || this.status === 429 || this.status === 408) return true;
    // Changed by others at the same time: read it and try again.
    if (this.code === ErrorCode.changedMeanwhile) return true;
    if (this.status === 409) return false;
    return this.status >= 500;
  }
}

function sentence(p: Problem): string {
  if (p.code === undefined && p.status >= 300 && p.status < 400) {
    return `cairnpost: the server answered ${p.status}, a redirect: the base URL must be the server's own address`;
  }
  if (p.code === undefined) return `cairnpost: the server answered ${p.status}, and not as CairnPost does`;
  return `cairnpost: ${p.code} (${p.status}): ${p.detail ?? ""}`;
}

/** The short name of an error of the runtime's, or of what caused it. */
function codeOf(cause: unknown): string | undefined {
  for (let at = cause, depth = 0; typeof at === "object" && at !== null && depth < 5; depth++) {
    const code = (at as { code?: unknown }).code;
    if (typeof code === "string" && /^[A-Z][A-Z0-9_]{1,40}$/.test(code)) return code;
    at = (at as { cause?: unknown }).cause;
  }
  return undefined;
}

/** Why a call got no answer it could read. */
export type TransportReason =
  /** The server was not reached, or the connection broke. */
  | "network"
  /** The time given to the call ran out. */
  | "timeout"
  /** The caller's own signal ended the call. */
  | "cancelled"
  /** The answer is larger than the client reads. */
  | "too_large"
  /** The answer was not what a CairnPost server gives. */
  | "not_cairnpost";

const reasons: Record<TransportReason, string> = {
  network: "the server was not reached, or the connection broke",
  timeout: "the time given to the call ran out",
  cancelled: "the call was cancelled",
  too_large: "the answer is larger than the client reads; see maxAnswerBytes",
  not_cairnpost: "the answer was not the JSON a CairnPost server gives",
};

/**
 * A call that got no answer it could read: the server was not reached,
 * the connection broke, or the time ran out. For a send it leaves open
 * whether the email went.
 */
export class TransportError extends Error {
  override readonly name = "TransportError";
  readonly reason: TransportReason;
  /**
   * The runtime's short name for what went wrong underneath, such as
   * "ECONNREFUSED" or "UND_ERR_SOCKET"; undefined when it gave none.
   */
  readonly causeCode: string | undefined;

  constructor(reason: TransportReason, cause?: unknown) {
    super(`cairnpost: no answer from the server: ${reasons[reason]}`);
    this.reason = reason;
    // Only its short name is kept. The runtime's error itself is not: it
    // can hold the bytes the other side answered, and a peer that says
    // back what it was sent would put the key and the email in it.
    this.causeCode = codeOf(cause);
  }
}

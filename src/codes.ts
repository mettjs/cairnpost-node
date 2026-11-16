/** Names of the errors CairnPost answers, as `CairnPostError.code` holds them. */
export const ErrorCode = {
  validation: "validation_error",
  rejectedByUpstream: "rejected_by_upstream",
  /**
   * The mail provider refused the email, and the sending domain's DNS
   * lacks a record the provider asks. The domain is likely not set up
   * with the provider, which then refuses every email from it: this is
   * the sender failing, not one bad email. A server before 0.1.1 says
   * `rejectedByUpstream` instead.
   */
  senderDomainNotReady: "sender_domain_not_ready",
  recipientSuppressed: "recipient_suppressed",
  idempotentMismatch: "invalid_idempotent_request",
  idempotentInFlight: "concurrent_idempotent_requests",
  missingKey: "missing_api_key",
  invalidKey: "invalid_api_key",
  domainNotAllowed: "domain_not_allowed",
  adminKeyRequired: "admin_key_required",
  notFound: "not_found",
  /** The server has nothing at the path asked for: the base URL is wrong, or the server is older than this client. */
  routeNotFound: "route_not_found",
  /** The path is there and does not take the method: the server is older or newer than this client. */
  methodNotAllowed: "method_not_allowed",
  tooLarge: "request_too_large",
  /** The request did not arrive whole in time. Nothing was done with it. */
  requestIncomplete: "request_incomplete",
  rateLimited: "rate_limit_exceeded",
  upstreamUnknown: "upstream_unknown",
  upstreamDown: "upstream_unavailable",
  unavailable: "unavailable",
  /** The email to cancel or move does not wait to be sent: it is being sent, was sent, or was cancelled. */
  notScheduled: "not_scheduled",
  /** The emails waiting to be sent hold as much as the server keeps. Nothing was kept or sent. */
  scheduleFull: "schedule_full",
  /** A batch ended before this email's turn. Nothing of it was sent. */
  notStarted: "not_started",
  /** The sending domain already has a template of that name. */
  nameTaken: "name_taken",
  /** What was to be changed was changed by others at the same time. Read it and try again. */
  changedMeanwhile: "changed_meanwhile",
  internal: "internal_error",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

// Every name above: an answer under one of them is CairnPost's.
const known = new Set<string>(Object.values(ErrorCode));

/** Says whether a name is one of CairnPost's own. */
export function isKnown(name: unknown): name is ErrorCode {
  return typeof name === "string" && known.has(name);
}

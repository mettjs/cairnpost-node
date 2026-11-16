import { count, fields, maybeText, maybeTime, present, text, time } from "./read.ts";
import type { CallOptions } from "./transport.ts";

/** States of a webhook delivery. */
export const DeliveryState = {
  /** Owed; it will be tried, or tried again. */
  pending: "pending",
  /** The endpoint took it. */
  delivered: "delivered",
  /** Every try was used up. */
  failed: "failed",
} as const;

/** One webhook owed to one endpoint, and how it went. */
export interface Delivery {
  /** Also the webhook's id as its receiver sees it (`WebhookEvent.id`). */
  id: string;
  /** The email the webhook is about; undefined for one about no email sent (`address.suppressed`, `email.received`). */
  emailId?: string;
  /** The received email the webhook is about, for an `email.received`. */
  inboundId?: string;
  /** The webhook's type (see `EventType`). */
  type: string;
  /** One of `DeliveryState`. */
  state: string;
  attempts: number;
  /** The endpoint's status at the last try; undefined for none. */
  lastStatus?: number;
  /** Why the last try failed; undefined if it did not. */
  lastFailure?: string;
  createdAt: Date;
  attemptedAt?: Date;
  deliveredAt?: Date;
  nextAttemptAt?: Date;
}

/** Narrows and pages an endpoint's deliveries. */
export interface DeliveryQuery extends CallOptions {
  /** Narrows to one state (one of `DeliveryState`); left out for all. */
  state?: string | undefined;
  /** The page's size; left out for the server's own (50). 200 at most. */
  limit?: number | undefined;
  /** The `next` of the page before; left out for the first page. */
  after?: string | undefined;
}

export function readDelivery(v: unknown): Delivery {
  const o = fields(v);
  return present<Delivery>({
    id: text(o, "id"),
    emailId: maybeText(o, "email_id"),
    inboundId: maybeText(o, "inbound_id"),
    type: text(o, "type"),
    state: text(o, "state"),
    attempts: count(o, "attempts"),
    lastStatus: count(o, "last_status") || undefined,
    lastFailure: maybeText(o, "last_failure"),
    createdAt: time(o, "created_at"),
    attemptedAt: maybeTime(o, "attempted_at"),
    deliveredAt: maybeTime(o, "delivered_at"),
    nextAttemptAt: maybeTime(o, "next_attempt_at"),
  });
}

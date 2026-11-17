/** Types of webhook CairnPost sends. */
export const EventType = {
  delivered: "email.delivered",
  deliveryDelayed: "email.delivery_delayed",
  bounced: "email.bounced",
  complained: "email.complained",
  failed: "email.failed",
  /**
   * Tells of an address put on the suppression list because of a bounce
   * or a complaint about an email the server has no record of. It is
   * about no email: `suppression` says which address. An email on record
   * says the same in its own webhook (`event.email.suppressed`).
   */
  addressSuppressed: "address.suppressed",
  /**
   * Tells of an email that came for an address of a sending domain. It is
   * about no email that was sent: `received` says who from, who for, and
   * the id to read it by. It never says what the email says.
   */
  received: "email.received",
  /** Sent when an endpoint is tried out. It is about no email. */
  test: "webhook.test",
} as const;

/** Types of bounce, in an `email.bounced` webhook. */
export const BounceType = {
  /** The address will never take mail. It is the only one that says the address is at fault. */
  permanent: "Permanent",
  /**
   * The receiving server refused for good, for a reason that is the
   * sender's (a failed signature, a policy, a blocklist). The address may
   * be perfectly good.
   */
  policy: "Policy",
  /** Refused for now. */
  transient: "Transient",
} as const;

/** A webhook from CairnPost, verified. */
export interface WebhookEvent {
  /**
   * Names the webhook. It is the same on every try of it, so a receiver
   * that may be sent one twice tells by this.
   */
  id: string;
  /** One of `EventType`; a type this client does not know is passed through as it is. */
  type: string;
  /** When the event happened. */
  at: Date;
  /** The email the event is about; undefined for `webhook.test`, `address.suppressed` and `email.received`. */
  email?: EventEmail;
  /** Set for `address.suppressed`. */
  suppression?: EventSuppression;
  /** Set for `email.received`. */
  received?: EventReceived;
}

/** The email a webhook is about. Never its subject or body. */
export interface EventEmail {
  id: string;
  from: string;
  /** The one address the event is about, also when the email went to several. */
  to: string[];
  /** When the email was made. Set for every type this client knows; only one it does not know can leave it out. */
  createdAt?: Date;
  /** The receiving server's status ("5.1.1"). */
  code?: string;
  /** The mail provider's short name for what happened. */
  reason?: string;
  /** Set for `email.bounced`: its `type` is one of `BounceType`. */
  bounce?: { type: string };
  /**
   * Says that, with this event, the address is on the sending domain's
   * suppression list: CairnPost will refuse to send to it from there
   * until the suppression is lifted.
   */
  suppressed: boolean;
}

/**
 * The address an `address.suppressed` webhook is about: the server will
 * refuse to send to it from that sending domain until the suppression is
 * lifted.
 */
export interface EventSuppression {
  domain: string;
  address: string;
  /** "bounce" (the address refused an email for good) or "complaint" (its owner marked one as spam). */
  reason: string;
}

/**
 * The email an `email.received` webhook is about: read what it says with
 * `received.get` and an admin key.
 */
export interface EventReceived {
  /** The received email's id. */
  id: string;
  /** Who it came from, as the sending server said: "" for a mail server's own notice, such as a bounce. */
  from: string;
  /** The address it came for. */
  to: string[];
  receivedAt: Date;
}

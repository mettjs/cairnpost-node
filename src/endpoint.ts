import { type Fields, fields, flag, maybeText, maybeTime, Misshapen, present, text, texts, time } from "./read.ts";

/** An endpoint: a URL CairnPost tells what becomes of emails. */
export interface Webhook {
  id: string;
  url: string;
  /** The sending domain it hears about; undefined for every domain. */
  domain?: string;
  /** The types it hears about (see `EventType`); empty for every type. */
  events: string[];
  description?: string;
  enabled: boolean;
  createdAt: Date;
  /** Set while every try since then has failed. */
  failingSince?: Date;
  /**
   * Set while the endpoint is paused: it failed every try for longer than
   * the server allows. It is still owed everything that happens, and
   * nothing is sent to it until `resume`.
   */
  pausedAt?: Date;
  /**
   * Set after `rotateSecret`: until then the server signs with the secret
   * before as well as the new one. Undefined when no older secret signs:
   * none was changed lately, or the server is set to end an old secret at
   * once.
   */
  previousSecretUntil?: Date;
  /**
   * The signing secret, for a `Verifier`. It is set only on the answers
   * to `create` and `rotateSecret` and is never said again: keep it.
   */
  secret?: string;
}

/** An endpoint to create. Only `url` is required. */
export interface NewWebhook {
  url: string;
  domain?: string | undefined;
  events?: string[] | undefined;
  description?: string | undefined;
}

/**
 * What to change about an endpoint. A field left out is left as it is; a
 * field that is set is changed to exactly that, so `enabled: false`
 * disables it and `events: []` makes it hear about every type.
 */
export interface WebhookChange {
  url?: string | undefined;
  events?: string[] | undefined;
  description?: string | undefined;
  enabled?: boolean | undefined;
}

/** How an endpoint answered a webhook sent to try it out. */
export interface WebhookTest {
  /** Says the endpoint took it. */
  delivered: boolean;
  /** The endpoint's HTTP status; undefined when it gave none. */
  status?: number;
  /** Why it was not delivered: "timeout", "refused", "dns", "tls", "blocked", "status" or "other". */
  failure?: string;
}

export function readWebhook(v: unknown): Webhook {
  const o: Fields = fields(v);
  const w = present<Webhook>({
    id: text(o, "id"),
    url: text(o, "url"),
    domain: maybeText(o, "domain"),
    events: texts(o, "events"),
    description: maybeText(o, "description"),
    enabled: flag(o, "enabled"),
    createdAt: time(o, "created_at"),
    failingSince: maybeTime(o, "failing_since"),
    pausedAt: maybeTime(o, "paused_at"),
    previousSecretUntil: maybeTime(o, "previous_secret_until"),
    secret: maybeText(o, "secret"),
  });
  if (w.id === "") throw new Misshapen();
  return w;
}

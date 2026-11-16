import { type FileInfo, readFile } from "./message.ts";
import { count, fields, flag, has, list, maybeText, maybeTime, Misshapen, part, present, text, textMap, texts, time } from "./read.ts";

/** The mail provider's sending allowance and how much is used. */
export interface Quota {
  limit: number;
  /** The span the limit counts over, such as "day". */
  per: string;
  used: number;
  /** Says the allowance is used up. */
  over: boolean;
  resetsAt?: Date;
}

/** What the server knows of how much more it may send. */
export interface Limits {
  /** The mail provider in use. */
  driver: string;
  /** Undefined for a provider that has no allowance to tell. */
  quota?: Quota;
}

/** Whether the server can do its work. */
export interface Health {
  /** Says the server is up and its database answers. */
  ok: boolean;
  /** "ok", or "unavailable" when its database does not answer. */
  status: string;
  driver: string;
  version: string;
  /** Whether delivery events are being read: "reading", "failing" or "off". Mail still goes while any part is failing. */
  events: string;
  /** Whether webhooks are being sent: "sending", "failing" or "off". */
  webhooks: string;
  /** Whether old records are being deleted: "running", "failing" or "off". */
  pruning: string;
  /** Whether the emails asked for ahead of time are being sent: "sending", "failing" or "off". */
  scheduled: string;
  /** Whether the server takes the emails that come for its domains' addresses: "on" or "off". */
  inbound: string;
}

/** An email a development server kept instead of sending. */
export interface CapturedEmail {
  id: string;
  at: Date;
  from: string;
  fromName?: string;
  to: string[];
  cc: string[];
  bcc: string[];
  replyTo?: string;
  subject: string;
  html?: string;
  text?: string;
  headers?: Record<string, string>;
  /** What files it had; a captured email holds no file's bytes. */
  attachments: FileInfo[];
}

export function readLimits(v: unknown): Limits {
  const o = has(fields(v), "driver");
  return present<Limits>({
    driver: text(o, "driver"),
    quota: part(o, "quota", (q) =>
      present<Quota>({ limit: count(q, "limit"), per: text(q, "per"), used: count(q, "used"), over: flag(q, "over"), resetsAt: maybeTime(q, "resets_at") }),
    ),
  });
}

export function readHealth(v: unknown): Health {
  const o = fields(v);
  const status = text(o, "status");
  // Anything that does not say how it is is not a CairnPost server.
  if (status === "") throw new Misshapen();
  return {
    ok: status === "ok",
    status,
    driver: text(o, "driver"),
    version: text(o, "version"),
    events: text(o, "events"),
    webhooks: text(o, "webhooks"),
    pruning: text(o, "pruning"),
    scheduled: text(o, "scheduled"),
    inbound: text(o, "inbound"),
  };
}

export function readCaptured(v: unknown): CapturedEmail[] {
  return list(has(fields(v), "data"), "data", (item) => {
    const o = fields(item);
    return present<CapturedEmail>({
      id: text(o, "id"),
      at: time(o, "at"),
      from: text(o, "from"),
      fromName: maybeText(o, "from_name"),
      to: texts(o, "to"),
      cc: texts(o, "cc"),
      bcc: texts(o, "bcc"),
      replyTo: maybeText(o, "reply_to"),
      subject: text(o, "subject"),
      html: maybeText(o, "html"),
      text: maybeText(o, "text"),
      headers: textMap(o, "headers"),
      attachments: list(o, "attachments", readFile),
    });
  });
}

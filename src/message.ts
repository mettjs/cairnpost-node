import { count, type Fields, fields, flag, list, maybeText, maybeTime, part, present, said, text, textMap, texts, time } from "./read.ts";

/** States of an email. */
export const State = {
  /** It waits to be sent at its time. */
  scheduled: "scheduled",
  /** It was to be sent later and was cancelled. */
  cancelled: "cancelled",
  /** Handed to the provider, no answer yet. */
  sending: "sending",
  /** The provider took it. */
  sent: "sent",
  /** The receiving server said "not now". */
  deferred: "deferred",
  /** The receiving server took it. */
  delivered: "delivered",
  /** The receiving server refused it. */
  bounced: "bounced",
  /** Its recipient marked it as spam. */
  complained: "complained",
  /** It was not sent. */
  failed: "failed",
  /** The provider's answer was lost. */
  unknown: "unknown",
} as const;

/** What became of an email. */
export interface Message {
  id: string;
  from: string;
  /** The first address the email went to, and `state` what became of it there. `recipients` has every address with its own. */
  to: string;
  /** One of `State`; a state this client does not know is passed through. */
  state: string;
  recipients: Recipient[];
  /** The addresses it was asked to go to and did not, being on the suppression list when it was sent. */
  suppressed: string[];
  /** When an email that waits will be sent, or would have been, had it not been cancelled; undefined for one that was sent. */
  scheduledAt?: Date;
  /**
   * Why it was cancelled when nobody asked: "suppressed" (nobody it named
   * in `to` or `cc` could be sent to any more), "key_revoked" (its API
   * key was revoked while it waited) or "failed" (the server could not
   * send it).
   */
  reason?: string;
  createdAt: Date;
  updatedAt: Date;
  /** What happened to it after it was sent, oldest first. */
  events: MessageEvent[];
  /** What the email said: undefined unless the server keeps content, it is still within its time, and the key is an admin key. */
  content?: Content;
}

/** One address of an email and what became of it there. */
export interface Recipient {
  address: string;
  /** "to", "cc" or "bcc". */
  kind: string;
  state: string;
  updatedAt: Date;
}

/** One thing that happened to an email. */
export interface MessageEvent {
  /** "delivered", "deferred", "bounced", "complained" or "failed". */
  type: string;
  at: Date;
  /** The address it happened at. */
  to?: string;
  /** Says, for a bounce, that the address will never take mail. */
  permanent: boolean;
  /** The receiving server's status ("5.1.1"). */
  code?: string;
  /** The mail provider's short name for what happened. */
  reason?: string;
  /** The receiving server's own sentence, kept only where content is. */
  detail?: string;
}

/**
 * What an attachment was. `kept` says the server still holds what was in
 * it, to be read back: while the email waits to be sent, and after that
 * where the server keeps emails' files with what they said.
 */
export interface FileInfo {
  filename: string;
  contentType: string;
  contentId?: string;
  size: number;
  kept: boolean;
}

/** What an email said, where the server is set to keep that. */
export interface Content {
  fromName?: string;
  replyTo?: string;
  subject: string;
  html?: string;
  text?: string;
  headers?: Record<string, string>;
  /** What files went with it. */
  attachments: FileInfo[];
  keptUntil: Date;
}

export function readFile(v: unknown): FileInfo {
  const o = fields(v);
  return present<FileInfo>({
    filename: text(o, "filename"),
    contentType: text(o, "content_type"),
    contentId: maybeText(o, "content_id"),
    size: count(o, "size"),
    kept: flag(o, "kept"),
  });
}

function readContent(o: Fields): Content {
  return present<Content>({
    fromName: maybeText(o, "from_name"),
    replyTo: maybeText(o, "reply_to"),
    subject: text(o, "subject"),
    html: maybeText(o, "html"),
    text: maybeText(o, "text"),
    headers: textMap(o, "headers"),
    attachments: list(o, "attachments", readFile),
    keptUntil: time(o, "kept_until"),
  });
}

export function readMessage(v: unknown): Message {
  const o = fields(v);
  return present<Message>({
    id: said(o, "id"),
    from: text(o, "from"),
    to: text(o, "to"),
    state: text(o, "state"),
    recipients: list(o, "recipients", (item) => {
      const r = fields(item);
      return { address: text(r, "address"), kind: text(r, "kind"), state: text(r, "state"), updatedAt: time(r, "updated_at") };
    }),
    suppressed: texts(o, "suppressed"),
    scheduledAt: maybeTime(o, "scheduled_at"),
    reason: maybeText(o, "reason"),
    createdAt: time(o, "created_at"),
    updatedAt: time(o, "updated_at"),
    events: list(o, "events", (item) => {
      const e = fields(item);
      return present<MessageEvent>({
        type: text(e, "type"),
        at: time(e, "at"),
        to: maybeText(e, "to"),
        permanent: flag(e, "permanent"),
        code: maybeText(e, "code"),
        reason: maybeText(e, "reason"),
        detail: maybeText(e, "detail"),
      });
    }),
    content: part(o, "content", readContent),
  });
}

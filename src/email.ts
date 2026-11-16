import { fields, maybeTime, Misshapen, text, texts } from "./read.ts";
import type { UseTemplate } from "./templates.ts";
import { headerSafe } from "./transport.ts";

/** One email, to one address or several. */
export interface Email {
  /** The sender: "app@example.com" or "App <app@example.com>". */
  from: string;
  /**
   * Who the email is for: one address at least. `cc` are copied in the
   * open, `bcc` without the others seeing them. No address twice; the
   * server says how many an email may name in all (50 by default).
   */
  to: string[];
  cc?: string[] | undefined;
  bcc?: string[] | undefined;
  replyTo?: string | undefined;
  /** Required, unless a `template` gives one. */
  subject?: string | undefined;
  /** The bodies; at least one is required, unless a `template` gives them. */
  html?: string | undefined;
  text?: string | undefined;
  /** Extra headers. */
  headers?: Record<string, string> | undefined;
  /** Files to send with it. */
  attachments?: Attachment[] | undefined;
  /**
   * Makes the email from a template the server keeps, in place of `html`
   * and `text`, which must then be left out. A `subject` given with it is
   * used instead of the template's.
   */
  template?: UseTemplate | undefined;
  /**
   * Has the email sent at that time and not now: the server keeps it
   * until then. It must be a time to come, and as far ahead as the server
   * allows (30 days by default).
   */
  scheduledAt?: Date | undefined;
  /**
   * Makes a repeated send one email: the same key with the same content
   * answers the first one's id. Use one for anything that may be retried.
   * It is remembered for a day by default. Printable ASCII, with no space
   * at either end.
   */
  idempotencyKey?: string | undefined;
}

/** A file sent with an email. */
export interface Attachment {
  /** The name its reader sees: a name, not a path. */
  filename: string;
  /** The file's bytes (a `Buffer` is one). */
  content: Uint8Array;
  /** Its media type ("application/pdf"); left out, the server tells it from the filename. */
  contentType?: string | undefined;
  /** Makes the file part of the HTML body, which shows it as "cid:" and this name; left out, it is a file beside the email. */
  contentId?: string | undefined;
}

/** The server's answer to a send. */
export interface Sent {
  /** The email's id: one, however many addresses it went to. */
  id: string;
  /**
   * The addresses it was not sent to, because they are on the sending
   * domain's suppression list. Empty when it went to all. An email with
   * nobody left in `to` or `cc` is an error instead
   * (`recipient_suppressed`): a `bcc` alone is not sent.
   */
  suppressed: string[];
  /**
   * When the email will be sent, for one asked for with `scheduledAt`: it
   * waits, and nothing was sent yet. Undefined for an email that was sent.
   */
  scheduledAt?: Date;
}

const some = <T>(items: T[] | undefined): T[] | undefined => (items && items.length > 0 ? items : undefined);

/**
 * An email as the server takes it: only the fields it names, since it
 * refuses any other. A field that holds nothing is left out.
 */
export function wireOf(e: Email): Record<string, unknown> {
  const headers = e.headers && Object.keys(e.headers).length > 0 ? e.headers : undefined;
  return {
    from: e.from,
    to: e.to,
    cc: some(e.cc),
    bcc: some(e.bcc),
    reply_to: e.replyTo || undefined,
    subject: e.subject ?? "",
    html: e.html || undefined,
    text: e.text || undefined,
    headers,
    attachments: some(e.attachments)?.map((f) => ({
      filename: f.filename,
      content: base64(f.content),
      content_type: f.contentType || undefined,
      content_id: f.contentId || undefined,
    })),
    scheduled_at: e.scheduledAt === undefined ? undefined : instant(e.scheduledAt),
    template: e.template && { name: e.template.name, variables: e.template.variables },
  };
}

function base64(content: Uint8Array): string {
  if (!(content instanceof Uint8Array)) throw new TypeError("cairnpost: an attachment's content must be bytes (a Uint8Array or a Buffer)");
  return Buffer.from(content.buffer, content.byteOffset, content.byteLength).toString("base64");
}

/** A time as the server reads one. */
export function instant(at: Date): string {
  if (!(at instanceof Date) || Number.isNaN(at.getTime())) throw new TypeError("cairnpost: a time to send the email at must be a valid Date");
  return at.toISOString();
}

/** The header that makes a send safe to repeat; none for no key. */
export function idempotency(key: string | undefined): Record<string, string> {
  if (key === undefined) return {};
  // A key a header cannot carry as it is would be dropped or changed on
  // the way, and the send would quietly not be idempotent. An empty one
  // is no key at all, where one was meant.
  if (typeof key !== "string" || !headerSafe(key)) {
    throw new TypeError("cairnpost: the idempotencyKey must be printable ASCII, not empty, with no space at either end; nothing was sent");
  }
  return { "idempotency-key": key };
}

/**
 * Reads the answer to one send. One with no id is not CairnPost's:
 * whatever is at that address, the email is not known to have been sent.
 * Nor is one that does not say an email asked for later waits: a server
 * too old to know the field would have refused it.
 */
export function readSent(v: unknown, later: boolean): Sent {
  const o = fields(v);
  const sent: Sent = { id: text(o, "id"), suppressed: texts(o, "suppressed") };
  const at = maybeTime(o, "scheduled_at");
  if (at) sent.scheduledAt = at;
  if (sent.id === "" || (at !== undefined) !== later) throw new Misshapen();
  return sent;
}

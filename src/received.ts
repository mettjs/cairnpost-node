import { reading } from "./answer.ts";
import { placeOf } from "./emails.ts";
import { type FileInfo, readFile } from "./message.ts";
import { largestPage, type Page, paging, readPage, walk } from "./pages.ts";
import { count, type Fields, fields, flag, list, maybeText, maybeTime, part, present, said, text, texts, time } from "./read.ts";
import type { CallOptions, Transport } from "./transport.ts";

/**
 * An email that came for an address of a sending domain and is kept by
 * the server for a time.
 */
export interface Received {
  id: string;
  /** The address it came for. */
  to: string;
  /**
   * Who it came from, as the sending server said: undefined for a mail
   * server's own notice, such as a bounce. Neither this nor `to` is what
   * the email says of itself: see `content`.
   */
  from?: string;
  receivedAt: Date;
  /** When the server stops showing it, and deletes it soon after. */
  keptUntil: Date;
  /** How long it is as it came, in bytes. */
  size: number;
  /** The email as it reads; left out in a list. */
  content?: ReceivedContent;
}

/**
 * What a received email says. A stranger wrote it: treat every part as
 * untrusted, and never show `html` as a page.
 */
export interface ReceivedContent {
  subject: string;
  from: string;
  to: string[];
  cc: string[];
  replyTo?: string;
  messageId?: string;
  /** When the email says it was written; undefined when it does not say. */
  date?: Date;
  text?: string;
  html?: string;
  headers: { name: string; value: string }[];
  /** Its files in the order they came: a file's place, for `file`, counts from 1. */
  attachments: FileInfo[];
  /**
   * Says some of it could not be read as it was written (a charset the
   * server does not know, a broken part): what is here may be incomplete.
   * `raw` has all of it.
   */
  partial: boolean;
}

/** Asks for a page of received emails. */
export interface ReceivedQuery extends CallOptions {
  /** The page's size; left out for the server's own (50). 200 at most. */
  limit?: number | undefined;
  /** The `next` of the page before; left out for the first page. */
  after?: string | undefined;
}

function readContent(o: Fields): ReceivedContent {
  return present<ReceivedContent>({
    subject: text(o, "subject"),
    from: text(o, "from"),
    to: texts(o, "to"),
    cc: texts(o, "cc"),
    replyTo: maybeText(o, "reply_to"),
    messageId: maybeText(o, "message_id"),
    date: maybeTime(o, "date"),
    text: maybeText(o, "text"),
    html: maybeText(o, "html"),
    headers: list(o, "headers", (item) => ({ name: text(fields(item), "name"), value: text(fields(item), "value") })),
    attachments: list(o, "attachments", readFile),
    partial: flag(o, "partial"),
  });
}

function readReceived(v: unknown): Received {
  const o = fields(v);
  return present<Received>({
    id: said(o, "id"),
    to: text(o, "to"),
    from: maybeText(o, "from"),
    receivedAt: time(o, "received_at"),
    keptUntil: time(o, "kept_until"),
    size: count(o, "size"),
    content: part(o, "content", readContent),
  });
}

/**
 * The emails that came for the server's domains' addresses, while it
 * keeps them. Every call needs an admin key.
 */
export class ReceivedEmails {
  readonly #t: Transport;

  /** @internal */
  constructor(transport: Transport) {
    this.#t = transport;
  }

  /**
   * Answers a page of the emails that came and are kept, newest first,
   * each without its `content`: all, or its sending domain's for a key
   * bound to one.
   */
  async list(q: ReceivedQuery = {}): Promise<Page<Received>> {
    const answer = await this.#t.json({ method: "GET", path: ["inbound"], query: paging(q.limit, q.after), signal: q.signal });
    return reading(answer, (v) => readPage(v, readReceived));
  }

  /**
   * Walks every email that came and is kept, newest first, a page at a
   * time. It ends at the first error, which it throws.
   */
  all(options: CallOptions = {}): AsyncGenerator<Received, void, void> {
    return walk((after) => this.list({ limit: largestPage, after, signal: options.signal }));
  }

  /**
   * Answers one email that came, with what it says. `isNotFound` says
   * there is none: the id is wrong, it came for another sending domain,
   * or its time is up.
   */
  async get(id: string, options: CallOptions = {}): Promise<Received> {
    return reading(await this.#t.json({ method: "GET", path: ["inbound", id], signal: options.signal }), readReceived);
  }

  /** Answers a received email as it came, every byte: what a mail program opens. */
  async raw(id: string, options: CallOptions = {}): Promise<Uint8Array> {
    return this.#t.bytes({ method: "GET", path: ["inbound", id, "raw"], signal: options.signal });
  }

  /**
   * Reads what one of a received email's files holds. `place` counts its
   * files from 1, in the order of `content.attachments`.
   */
  async file(id: string, place: number, options: CallOptions = {}): Promise<Uint8Array> {
    return this.#t.bytes({ method: "GET", path: ["inbound", id, "attachments", placeOf(place)], signal: options.signal });
  }

  /** Deletes a received email before its time. */
  async delete(id: string, options: CallOptions = {}): Promise<void> {
    await this.#t.empty({ method: "DELETE", path: ["inbound", id], signal: options.signal });
  }
}

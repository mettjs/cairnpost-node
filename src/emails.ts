import { type Batch, type BatchResult, readBatch } from "./batch.ts";
import { reading } from "./answer.ts";
import { type Email, idempotency, instant, readSent, type Sent, wireOf } from "./email.ts";
import { type Message, readMessage } from "./message.ts";
import { fields, Misshapen, text } from "./read.ts";
import type { CallOptions, Transport } from "./transport.ts";

/** Sending emails and reading what became of them. */
export class Emails {
  readonly #t: Transport;

  /** @internal */
  constructor(transport: Transport) {
    this.#t = transport;
  }

  /**
   * Sends an email and answers its id once the mail provider has taken
   * it. On an error, see `CairnPostError` for what to do and
   * `mayHaveSent` for whether the email may have gone; the error's
   * `emailId`, when set, can be read with `get`.
   */
  async send(email: Email, options: CallOptions = {}): Promise<Sent> {
    const headers = idempotency(email.idempotencyKey);
    // As it was asked: the email may be changed while the call is made.
    const later = email.scheduledAt !== undefined;
    const answer = await this.#t.json({ method: "POST", path: ["emails"], headers, body: wireOf(email), signal: options.signal });
    return reading(answer, (v) => readSent(v, later));
  }

  /**
   * Sends several emails in one request and answers what became of each,
   * in their order.
   *
   * The server checks every email before it sends any: one that could
   * never be sent refuses the batch, and this throws that
   * `CairnPostError` with nothing sent. An answer means the batch was
   * taken, not that every email went: read each result.
   *
   * After a `TransportError` any of the emails may have gone. Send the
   * same batch again with the same `idempotencyKey`, and only with it.
   */
  async sendBatch(batch: Batch, options: CallOptions = {}): Promise<BatchResult[]> {
    // As they were asked: the list may be changed while the call is made.
    const emails = [...batch.emails];
    emails.forEach((e, i) => {
      if (e.idempotencyKey !== undefined) {
        throw new TypeError(`cairnpost: email ${i + 1} has an idempotencyKey of its own: a batch has one, on the batch; nothing was sent`);
      }
    });
    const headers = idempotency(batch.idempotencyKey);
    const body = emails.map(wireOf);
    const later = emails.map((e) => e.scheduledAt !== undefined);
    const answer = await this.#t.json({ method: "POST", path: ["emails", "batch"], headers, body, signal: options.signal });
    return reading(answer, (v) => readBatch(v, later));
  }

  /**
   * Answers what became of an email. A send key sees the emails it sent;
   * an admin key sees any, or its sending domain's if it is bound to one.
   * `isNotFound` says there is none: the id is wrong, another key's, or
   * its record was deleted after the server's retention.
   */
  async get(id: string, options: CallOptions = {}): Promise<Message> {
    const answer = await this.#t.json({ method: "GET", path: ["emails", id], signal: options.signal });
    return reading(answer, (v) => {
      const m = readMessage(v);
      if (m.id === "") throw new Misshapen();
      return m;
    });
  }

  /**
   * Ends the wait of an email that was asked for with `scheduledAt`: it
   * will not be sent, and what it said is deleted from the server. The
   * key that asked for the email may, and an admin key that may read it.
   *
   * An email that no longer waits (it is being sent, was sent or was
   * cancelled) is a `CairnPostError` with the code `not_scheduled`.
   */
  async cancel(id: string, options: CallOptions = {}): Promise<void> {
    const answer = await this.#t.json({ method: "POST", path: ["emails", id, "cancel"], signal: options.signal });
    // Only CairnPost's own word that it is cancelled counts.
    reading(answer, (v) => named(v, "id"));
  }

  /**
   * Gives an email that waits another time to be sent at. Its errors are
   * those of `cancel`, and `validation_error` for a time it cannot be
   * sent at.
   */
  async reschedule(id: string, at: Date, options: CallOptions = {}): Promise<void> {
    const body = { scheduled_at: instant(at) };
    const answer = await this.#t.json({ method: "PATCH", path: ["emails", id], body, signal: options.signal });
    reading(answer, (v) => named(v, "id"));
  }

  /**
   * Reads what one of an email's files held, as it was sent. `place`
   * counts the email's files from 1, in the order of
   * `content.attachments`. An admin key only. `isNotFound` says there is
   * none: no email has this id, it has no file at that place, or the
   * server does not keep it (`FileInfo.kept` says whether it does).
   */
  async file(id: string, place: number, options: CallOptions = {}): Promise<Uint8Array> {
    return this.#t.bytes({ method: "GET", path: ["emails", id, "attachments", placeOf(place)], signal: options.signal });
  }
}

/** Holds an answer to saying the text CairnPost always says in it. */
export function named(v: unknown, key: string): void {
  if (text(fields(v), key) === "") throw new Misshapen();
}

/** A file's place as a path takes it. */
export function placeOf(place: number): string {
  if (!Number.isSafeInteger(place) || place < 1) throw new TypeError("cairnpost: a file's place counts from 1");
  return String(place);
}

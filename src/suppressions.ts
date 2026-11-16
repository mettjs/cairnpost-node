import { reading } from "./answer.ts";
import { largestPage, type Page, paging, readPage, walk } from "./pages.ts";
import { count, fields, flag, has, maybeText, present, text, time } from "./read.ts";
import type { CallOptions, Transport } from "./transport.ts";

/** Why an address is suppressed. */
export const Reason = {
  /** A receiving server refused it for good. */
  bounce: "bounce",
  /** Its owner marked an email as spam. */
  complaint: "complaint",
  /** Put there by hand. */
  manual: "manual",
} as const;

/** An address CairnPost will not send to from a domain. */
export interface Suppression {
  /** The sending domain it holds for. */
  domain: string;
  address: string;
  /** One of `Reason`. */
  reason: string;
  /** The email whose bounce or complaint caused it; undefined when there is none, or its record has been deleted. */
  emailId?: string;
  note?: string;
  createdAt: Date;
}

/** Narrows and pages a list of suppressions. */
export interface SuppressionQuery extends CallOptions {
  /** Narrows to one sending domain; left out for all. */
  domain?: string | undefined;
  /** The page's size; left out for the server's own (50). 200 at most. */
  limit?: number | undefined;
  /** The `next` of the page before; left out for the first page. */
  after?: string | undefined;
}

function readSuppression(v: unknown): Suppression {
  const o = fields(v);
  return present<Suppression>({
    domain: text(o, "domain"),
    address: text(o, "address"),
    reason: text(o, "reason"),
    emailId: maybeText(o, "email_id"),
    note: maybeText(o, "note"),
    createdAt: time(o, "created_at"),
  });
}

/** The addresses not sent to. Every call needs an admin key. */
export class Suppressions {
  readonly #t: Transport;

  /** @internal */
  constructor(transport: Transport) {
    this.#t = transport;
  }

  /** Answers one page of the addresses not sent to, in order of domain and address. */
  async list(q: SuppressionQuery = {}): Promise<Page<Suppression>> {
    const query = { ...paging(q.limit, q.after), domain: q.domain || undefined };
    const answer = await this.#t.json({ method: "GET", path: ["suppressions"], query, signal: q.signal });
    return reading(answer, (v) => readPage(v, readSuppression));
  }

  /**
   * Walks every suppression of a sending domain (left out for all), a
   * page at a time. It ends at the first error, which it throws.
   */
  all(domain?: string, options: CallOptions = {}): AsyncGenerator<Suppression, void, void> {
    // The largest page the server gives: fewer calls for a long list.
    return walk((after) => this.list({ domain, limit: largestPage, after, signal: options.signal }));
  }

  /**
   * Stops sending to an address from a sending domain. The note is
   * optional. It answers false when the address was suppressed already,
   * in which case nothing changed.
   */
  async add(domain: string, address: string, note?: string, options: CallOptions = {}): Promise<boolean> {
    const body = { domain, address, note: note || undefined };
    const answer = await this.#t.json({ method: "POST", path: ["suppressions"], body, signal: options.signal });
    return reading(answer, (v) => flag(has(fields(v), "added"), "added"));
  }

  /** Lets an address be sent to again from a sending domain. `isNotFound` says it was not suppressed. */
  async lift(domain: string, address: string, options: CallOptions = {}): Promise<void> {
    const answer = await this.#t.json({ method: "POST", path: ["suppressions", "lift"], body: { domain, address }, signal: options.signal });
    reading(answer, (v) => has(fields(v), "lifted"));
  }

  /**
   * Lifts every suppression of a sending domain, or those of one reason
   * (one of `Reason`; left out for all), and answers how many.
   */
  async liftAll(domain: string, reason?: string, options: CallOptions = {}): Promise<number> {
    const body = { domain, all: true, reason: reason || undefined };
    const answer = await this.#t.json({ method: "POST", path: ["suppressions", "lift"], body, signal: options.signal });
    return reading(answer, (v) => count(has(fields(v), "lifted"), "lifted"));
  }
}

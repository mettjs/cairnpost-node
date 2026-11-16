import { reading } from "./answer.ts";
import { Emails } from "./emails.ts";
import { isWrongAddress } from "./asks.ts";
import { ErrorCode } from "./codes.ts";
import { CairnPostError } from "./errors.ts";
import { ReceivedEmails } from "./received.ts";
import { type CapturedEmail, type Health, type Limits, readCaptured, readHealth, readLimits } from "./status.ts";
import { Suppressions } from "./suppressions.ts";
import { Templates } from "./templates.ts";
import { type CallOptions, headerSafe, Transport } from "./transport.ts";
import { Webhooks } from "./webhooks.ts";

/** This client's version, said in its User-Agent. */
export const version = "0.1.0";

/**
 * How long a call may take, in milliseconds. It is longer than the server
 * gives its slowest answer, a batch: by the server's own settings that is
 * 30 seconds for the request to arrive, a minute of starting emails, and
 * the last send and its record (10 and 20 seconds), two minutes in all. A
 * client that gave up sooner would not know whether its emails went. A
 * server set to give a send or a batch longer wants a client given longer.
 */
export const defaultTimeoutMs = 150_000;

/** The longest time a call can be given: what a timer of the runtime takes. */
const longestTimeoutMs = 2 ** 31 - 1;

/** How much of an answer is read unless `maxAnswerBytes` says otherwise. Only a development server's list of captured emails comes near it. */
export const defaultMaxAnswerBytes = 64 * 1024 * 1024;

export interface ClientOptions {
  /**
   * How long a call may take, in milliseconds; `defaultTimeoutMs` when
   * left out. Keep it above the server's send and batch timeouts. Node's
   * own `fetch` gives up after five minutes without an answer, whatever
   * this says: a server set to take longer wants a `fetch` of your own.
   */
  timeoutMs?: number | undefined;
  /** How much of an answer is read; a larger one is an error that says so. */
  maxAnswerBytes?: number | undefined;
  /** The application's name, put before the client's own in the User-Agent header. A name a header cannot carry is ignored. */
  userAgent?: string | undefined;
  /** The `fetch` to call through; the runtime's own when left out. It must not retry by itself. */
  fetch?: typeof fetch | undefined;
}

/**
 * Raised by `captured` when asked of a server that delivers for real: it
 * keeps no emails to show.
 */
export class NotCapturingError extends Error {
  override readonly name = "NotCapturingError";

  constructor() {
    super("cairnpost: the server delivers for real and keeps no captured emails");
  }
}

/**
 * Calls one CairnPost server with one API key. It never retries by
 * itself: an error says what happened and whether trying again is right
 * (see `CairnPostError`); the application decides.
 */
export class CairnPost {
  readonly #t: Transport;
  /** Sending emails and reading what became of them. */
  readonly emails: Emails;
  /** The addresses not sent to. Admin key. */
  readonly suppressions: Suppressions;
  /** The URLs told what becomes of emails. Admin key. */
  readonly webhooks: Webhooks;
  /** The templates emails are sent from. Admin key. */
  readonly templates: Templates;
  /** The emails that came for the server's addresses. Admin key. */
  readonly received: ReceivedEmails;

  /**
   * Makes a client for the server at `baseUrl` ("https://mail.example.com")
   * using `apiKey`. A send key may send and read its own emails; the
   * calls marked "admin key" need an admin key.
   */
  constructor(baseUrl: string, apiKey: string, options: ClientOptions = {}) {
    let url: URL | undefined;
    try {
      url = new URL(baseUrl);
    } catch {
      url = undefined;
    }
    if (url === undefined || (url.protocol !== "http:" && url.protocol !== "https:") || url.host === "" || url.username !== "" || url.password !== "") {
      throw new TypeError("cairnpost: the base URL must be http:// or https:// and name a host");
    }
    // A key read from a file often ends in a newline; one with anything
    // else a header cannot carry is refused here, not at the first call.
    const key = typeof apiKey === "string" ? apiKey.trim() : "";
    if (key === "" || !headerSafe(key) || key.includes(" ")) {
      throw new TypeError("cairnpost: an API key is required, and holds no spaces or control characters");
    }
    // Said here, not by the runtime at the first call, and by its name.
    const { timeoutMs, maxAnswerBytes } = options;
    if (timeoutMs !== undefined && !(Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= longestTimeoutMs)) {
      throw new TypeError(`cairnpost: timeoutMs must be a whole number of milliseconds, from 1 to ${longestTimeoutMs}`);
    }
    if (maxAnswerBytes !== undefined && !(Number.isSafeInteger(maxAnswerBytes) && maxAnswerBytes > 0)) {
      throw new TypeError("cairnpost: maxAnswerBytes must be a whole number above 0");
    }
    let agent = "cairnpost-node/" + version;
    if (options.userAgent && headerSafe(options.userAgent)) agent = options.userAgent + " " + agent;
    this.#t = new Transport({
      base: url.origin + url.pathname.replace(/\/+$/, ""),
      key,
      agent,
      timeoutMs: timeoutMs ?? defaultTimeoutMs,
      maxAnswerBytes: maxAnswerBytes ?? defaultMaxAnswerBytes,
      fetch: options.fetch ?? ((input, init) => fetch(input, init)),
    });
    this.emails = new Emails(this.#t);
    this.suppressions = new Suppressions(this.#t);
    this.webhooks = new Webhooks(this.#t);
    this.templates = new Templates(this.#t);
    this.received = new ReceivedEmails(this.#t);
  }

  /**
   * Asks the server how it is. It needs no key. A server that is up but
   * cannot reach its database is answered, not an error: see `ok`. With a
   * base URL that is wrong it fails as any call does, and
   * `isWrongAddress` says so: it is the call to check a configuration
   * with.
   */
  async health(options: CallOptions = {}): Promise<Health> {
    return reading(await this.#t.json({ method: "GET", path: ["health"], plain: true, signal: options.signal }), readHealth);
  }

  /** Answers the mail provider's sending allowance, so an application knows before it runs out. */
  async limits(options: CallOptions = {}): Promise<Limits> {
    return reading(await this.#t.json({ method: "GET", path: ["limits"], signal: options.signal }), readLimits);
  }

  /**
   * Answers the emails a server running the capture driver holds, newest
   * first: what would have been sent. For development and tests. A server
   * that delivers for real has no such list: the error is then a
   * `NotCapturingError`, unless `health` fails too, in which case the
   * base URL is what is wrong. Admin key.
   */
  async captured(options: CallOptions = {}): Promise<CapturedEmail[]> {
    try {
      return reading(await this.#t.json({ method: "GET", path: ["capture", "emails"], signal: options.signal }), readCaptured);
    } catch (err) {
      if (!(err instanceof CairnPostError) || err.code !== ErrorCode.routeNotFound) throw err;
      // The path is not there. If the server is, it is one that does not
      // capture; if nothing of CairnPost's is at that address, the first
      // error says so. Health failing any other way is its own error.
      try {
        await this.health(options);
      } catch (down) {
        throw isWrongAddress(down) ? err : down;
      }
      throw new NotCapturingError();
    }
  }
}

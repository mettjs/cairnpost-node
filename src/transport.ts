import { TransportError } from "./errors.ts";
import { problemOf } from "./problem.ts";

/** What every call takes besides what it is about. */
export interface CallOptions {
  /** Ends the call when it fires. A send ended this way may have gone. */
  signal?: AbortSignal | undefined;
}

/** One request to make. */
export interface Call {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  /** The route's segments; each is escaped, so an id is safe. */
  path: string[];
  query?: Record<string, string | undefined>;
  headers?: Record<string, string>;
  /** Sent as JSON; undefined for none. */
  body?: unknown;
  /** A route that needs no key and answers its own body on a 503. */
  plain?: boolean;
  signal?: AbortSignal | undefined;
}

export interface TransportSettings {
  base: string;
  key: string;
  agent: string;
  timeoutMs: number;
  maxAnswerBytes: number;
  fetch: typeof fetch;
}

/**
 * Says a value can be sent as a header as it is: printable ASCII, in one
 * line, with no space at either end. Checked here, not left to the
 * runtime, whose own error would repeat the value.
 */
export function headerSafe(v: string): boolean {
  return /^[\x21-\x7e]([\x20-\x7e]*[\x21-\x7e])?$/.test(v);
}

/** Makes the calls: each one once, with no retry and no redirect followed. */
export class Transport {
  // Private, so that a client printed or logged does not show its key.
  readonly #s: TransportSettings;

  constructor(settings: TransportSettings) {
    this.#s = settings;
  }

  /** Makes a call that answers JSON, and gives the answer as it was read. */
  async json(k: Call): Promise<unknown> {
    const { raw } = await this.#answer(k, "application/json");
    try {
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)) as unknown;
    } catch {
      // The answer's text is not quoted: it could hold an email's words.
      throw new TransportError("not_cairnpost");
    }
  }

  /**
   * Makes a call that CairnPost answers with nothing (204). Anything else
   * that says "fine" is not CairnPost saying it was done.
   */
  async empty(k: Call): Promise<void> {
    const { status, raw } = await this.#answer(k, "application/json");
    if (status !== 204 || raw.byteLength > 0) throw new TransportError("not_cairnpost");
  }

  /** Makes a call that answers a file's bytes. */
  async bytes(k: Call): Promise<Uint8Array> {
    const { raw, type } = await this.#answer(k, "application/octet-stream, application/json");
    // Anything else that answers 200 here is not a CairnPost server.
    if (type !== "application/octet-stream") throw new TransportError("not_cairnpost");
    return raw;
  }

  async #answer(k: Call, accept: string): Promise<{ raw: Uint8Array; type: string; status: number }> {
    const s = this.#s;
    let url = s.base;
    for (const segment of k.path) {
      // A segment of dots would be resolved away, and name another path.
      if (segment === "" || segment === "." || segment === "..") throw new TypeError("cairnpost: an id is required");
      url += "/" + encodeURIComponent(segment);
    }
    const query = new URLSearchParams();
    for (const [name, value] of Object.entries(k.query ?? {})) {
      if (value !== undefined) query.set(name, value);
    }
    if (query.size > 0) url += "?" + query.toString();
    const headers: Record<string, string> = { ...k.headers, accept, "user-agent": s.agent };
    let body: string | undefined;
    if (k.body !== undefined) {
      body = JSON.stringify(k.body);
      headers["content-type"] = "application/json";
    }
    if (!k.plain) headers["authorization"] = "Bearer " + s.key;
    const limit = AbortSignal.timeout(s.timeoutMs);
    const signal = k.signal ? AbortSignal.any([limit, k.signal]) : limit;
    let status: number;
    let raw: Uint8Array;
    let type: string;
    let retryAfter: string | null;
    try {
      // "manual": a redirect followed would turn a send into a request
      // with no email in it.
      const res = await s.fetch(url, { method: k.method, headers, body: body ?? null, redirect: "manual", signal });
      // A runtime that hides a redirect's status shows it as 0.
      status = res.type === "opaqueredirect" ? 302 : res.status;
      type = res.headers.get("content-type") ?? "";
      retryAfter = res.headers.get("retry-after");
      // Of an answer that is a refusal only its few short fields are
      // kept: no more of it is read than holds them.
      const fine = status >= 200 && status <= 299;
      raw = fine ? await readAtMost(res, s.maxAnswerBytes, false) : await readAtMost(res, Math.min(s.maxAnswerBytes, mostOfARefusal), true);
    } catch (cause) {
      if (cause instanceof TransportError) throw cause;
      if (k.signal?.aborted) throw new TransportError("cancelled", cause);
      throw new TransportError(limit.aborted || ranOut(cause) ? "timeout" : "network", cause);
    }
    if (status >= 200 && status <= 299) return { raw, type, status };
    const problem = problemOf(status, raw, retryAfter);
    // A plain call's 503 is an answer to read (the server is up and says
    // what is not); anything else it is refused with is an error like
    // any other, a path that is not there above all.
    if (k.plain && problem.code === undefined && status === 503) return { raw, type, status };
    throw problem;
  }
}

/** How much of an answer that is a refusal is read. */
const mostOfARefusal = 64 * 1024;

/**
 * Says the runtime itself gave up waiting. Node's own fetch waits five
 * minutes for an answer to begin, whatever longer time the client was
 * given.
 */
function ranOut(cause: unknown): boolean {
  const code = (cause as { cause?: { code?: unknown } } | null)?.cause?.code;
  return code === "UND_ERR_HEADERS_TIMEOUT" || code === "UND_ERR_BODY_TIMEOUT";
}

/**
 * Reads an answer's body, and no more of it than `most`: a longer one is
 * an error, or with `cut` is read that far and left.
 */
async function readAtMost(res: Response, most: number, cut: boolean): Promise<Uint8Array> {
  if (res.body === null) return new Uint8Array();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (size + value.byteLength > most) {
      await reader.cancel().catch(() => {});
      if (!cut) throw new TransportError("too_large");
      break;
    }
    size += value.byteLength;
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    all.set(chunk, at);
    at += chunk.byteLength;
  }
  return all;
}

import http from "node:http";
import type { AddressInfo } from "node:net";
import type { TestContext } from "node:test";
import { CairnPost, type ClientOptions } from "../src/index.ts";

/** A request as the server got it. */
export interface Seen {
  method: string;
  /** The path as it travelled, still escaped, without its query. */
  path: string;
  query: string;
  auth: string;
  idem: string;
  agent: string;
  contentType: string;
  body: string;
}

export type Answer = (res: http.ServerResponse, n: number, seen: Seen) => void;

export interface Stand {
  seen: Seen[];
  url: string;
  client: CairnPost;
}

export const key = "cp_test_KEYMARK";

/** Starts a server that records each request and answers what it is told, and a client of it. */
export async function serving(t: TestContext, answer: Answer, options: ClientOptions = {}, base = ""): Promise<Stand> {
  const seen: Seen[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const [path = "", query = ""] = (req.url ?? "").split("?");
      const one = (name: string) => String(req.headers[name] ?? "");
      const got: Seen = {
        method: req.method ?? "",
        path,
        query,
        auth: one("authorization"),
        idem: one("idempotency-key"),
        agent: one("user-agent"),
        contentType: one("content-type"),
        body: Buffer.concat(chunks).toString("utf8"),
      };
      seen.push(got);
      answer(res, seen.length, got);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { seen, url, client: new CairnPost(url + base, key, options) };
}

/** A stand that answers every request with one status and body. */
export function serve(t: TestContext, status: number, body: string, options: ClientOptions = {}): Promise<Stand> {
  return serving(t, (res) => res.writeHead(status).end(body), options);
}

/** Runs what should fail, and answers what it threw. */
export async function thrown(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (err) {
    return err;
  }
  throw new Error("nothing was thrown");
}

export const email = { from: "a@example.com", to: ["b@example.org"], subject: "s", text: "t" };

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { inspect } from "node:util";
import { CairnPost, isNotFound, CairnPostError, ErrorCode, mayHaveSent, TransportError, version } from "../src/index.ts";
import { email, key, serve, serving, thrown, up } from "./stand.ts";

test("the client refuses what cannot work", () => {
  for (const base of ["", "mail.example.com", "ftp://mail.example.com", "https://", "https://user:pass@mail.example.com"]) {
    assert.throws(() => new CairnPost(base, "key"), TypeError, `${base} was taken as a base URL`);
  }
  for (const bad of ["", " ", "cp_a\nb", "cp_a\x00b", "cp_a b", "cp_é"]) {
    assert.throws(() => new CairnPost("https://mail.example.com", bad), TypeError, `${JSON.stringify(bad)} was taken as a key`);
  }
});

test("a refused key is not repeated in the error", () => {
  try {
    new CairnPost("https://mail.example.com", "cp_KEYMARK\nb");
    assert.fail("taken");
  } catch (err) {
    assert.ok(!inspect(err).includes("KEYMARK"));
  }
});

test("a base URL with a path is kept, and the application is named first", async (t) => {
  const s = await serving(t, (res) => res.end('{"id":"m","created_at":"2030-01-01T00:00:00Z","updated_at":"2030-01-01T00:00:00Z"}'), { userAgent: "billing/2" }, "/mail/");
  await s.client.emails.get("m");
  assert.equal(s.seen[0]?.path, "/mail/emails/m");
  assert.ok(s.seen[0]?.agent.startsWith(`billing/2 cairnpost-node/${version}`));
  const odd = new CairnPost(s.url, key, { userAgent: "bad\nname" });
  await odd.emails.get("m");
  assert.equal(s.seen[1]?.agent, `cairnpost-node/${version}`);
});

test("the version is the package's", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
  assert.equal(version, pkg.version);
});

test("a key is sent without the space around it, and is not shown", async (t) => {
  const s = await serving(t, (res) => res.end(up));
  const client = new CairnPost(s.url, " cp_test_KEYMARK\n");
  await client.limits();
  assert.equal(s.seen[0]?.auth, "Bearer cp_test_KEYMARK");
  // Health needs no key, and is sent none.
  await client.health();
  assert.equal(s.seen[1]?.auth, "");
  assert.ok(!inspect(client, { depth: 9, showHidden: true }).includes("KEYMARK"));
  assert.ok(!JSON.stringify(client).includes("KEYMARK"));
});

test("a redirect is not followed, and is said as what it is", async (t) => {
  const s = await serving(t, (res) => res.writeHead(301, { location: "/elsewhere" }).end());
  const err = await thrown(() => s.client.emails.send(email));
  assert.ok(err instanceof CairnPostError);
  assert.equal(err.status, 301);
  assert.equal(s.seen.length, 1);
  assert.ok(!isNotFound(err));
  assert.match(err.message, /redirect/);
});

test("an answer too large says so", async (t) => {
  const s = await serving(t, (res) => res.end(`{"data":[{"id":"c1","at":"2030-01-01T00:00:00Z","subject":"${"x".repeat(4096)}"}]}`));
  const small = new CairnPost(s.url, key, { maxAnswerBytes: 1024 });
  const err = await thrown(() => small.captured());
  assert.ok(err instanceof TransportError);
  assert.equal(err.reason, "too_large");
  assert.match(err.message, /larger than the client reads/);
  const roomy = new CairnPost(s.url, key, { maxAnswerBytes: 1 << 20 });
  assert.equal((await roomy.captured()).length, 1);
});

// The client makes each call once. A runtime that sent again a request
// whose kept connection dropped could send an email twice, or be told
// "in flight" about its own first try.
test("a send is made once even when the connection drops", async (t) => {
  for (const idempotencyKey of [undefined, "welcome-42"]) {
    let posts = 0;
    const s = await serving(t, (res, _n, seen) => {
      if (seen.method === "GET") return void res.end(up); // leaves a connection to reuse
      posts++;
      res.socket?.destroy(); // the request was read; hang up without an answer
    });
    await s.client.health();
    const err = await thrown(() => s.client.emails.send({ ...email, idempotencyKey }));
    assert.ok(err instanceof TransportError, String(err));
    assert.equal(err.reason, "network");
    assert.ok(mayHaveSent(err));
    assert.equal(posts, 1);
  }
});

test("a call that runs out of time, or is cancelled, says which", async (t) => {
  const s = await serving(t, () => {}, { timeoutMs: 30 });
  const late = await thrown(() => s.client.emails.send(email));
  assert.ok(late instanceof TransportError && late.reason === "timeout" && mayHaveSent(late));
  const patient = new CairnPost(s.url, key);
  const stop = new AbortController();
  setTimeout(() => stop.abort(), 20);
  const stopped = await thrown(() => patient.emails.send(email, { signal: stop.signal }));
  assert.ok(stopped instanceof TransportError && stopped.reason === "cancelled" && mayHaveSent(stopped));
});

test("a time or a size the runtime cannot take is refused when the client is made", () => {
  for (const timeoutMs of [0, -1, 1.5, Infinity, NaN, 5e9, 2 ** 32]) {
    assert.throws(() => new CairnPost("https://mail.example.com", key, { timeoutMs }), /timeoutMs/, String(timeoutMs));
  }
  for (const maxAnswerBytes of [0, -1, 1.5, Infinity]) {
    assert.throws(() => new CairnPost("https://mail.example.com", key, { maxAnswerBytes }), /maxAnswerBytes/);
  }
  new CairnPost("https://mail.example.com", key, { timeoutMs: 600_000, maxAnswerBytes: 1 });
});

// A long page from something that is not CairnPost is not read whole
// to say that it is not CairnPost's.
test("a refusal is read no further than its few fields need", async (t) => {
  for (const maxAnswerBytes of [1024, 1 << 20, undefined]) {
    const s = await serve(t, 502, "<html>" + "x".repeat(1 << 20), { maxAnswerBytes });
    const err = await thrown(() => s.client.emails.send(email));
    assert.ok(err instanceof CairnPostError && err.status === 502 && err.code === undefined && mayHaveSent(err), `reading ${maxAnswerBytes} bytes`);
  }
});

// A refusal longer than is read is not CairnPost's: nothing of what
// was read of it is believed, a name that says "nothing was sent" least
// of all.
test("a refusal longer than is read is its status alone", async (t) => {
  const s = await serving(t, (res) => {
    res.writeHead(503);
    res.write(`{"statusCode":503,"name":"unavailable","message":"Down.","id":"msg-1"}`);
    setImmediate(() => res.end(" ".repeat(80 * 1024)));
  });
  const err = await thrown(() => s.client.emails.send(email));
  assert.ok(err instanceof CairnPostError && err.status === 503 && err.code === undefined && err.emailId === undefined && mayHaveSent(err));
});

// CairnPost's own refusal is read whole under a limit smaller than it:
// its name says whether the email may have gone.
test("a refusal longer than the limit on answers keeps its name", async (t) => {
  const body = `{"statusCode":422,"name":"recipient_suppressed","message":"${"Suppressed. ".repeat(40)}","id":"msg-1"}`;
  const s = await serve(t, 422, body, { maxAnswerBytes: 100 });
  const err = await thrown(() => s.client.emails.send(email));
  assert.ok(err instanceof CairnPostError && err.code === ErrorCode.recipientSuppressed && err.emailId === "msg-1" && mayHaveSent(err));
});

test("an id that would name another path is not asked of the server", async (t) => {
  const s = await serve(t, 200, "{}");
  for (const id of ["", ".", "..", 42 as unknown as string, undefined as unknown as string]) {
    assert.ok((await thrown(() => s.client.emails.get(id))) instanceof TypeError);
    assert.ok((await thrown(() => s.client.webhooks.retryDelivery("w", id))) instanceof TypeError);
  }
  assert.equal(s.seen.length, 0);
});

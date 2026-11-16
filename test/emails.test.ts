import assert from "node:assert/strict";
import { test } from "node:test";
import { CairnPostError, ErrorCode, failed, isNotFound, mayHaveSent, State, TransportError } from "../src/index.ts";
import { email, serve, serving, thrown } from "./stand.ts";

test("a send says only what the server names", async (t) => {
  const s = await serve(t, 200, `{"id":"msg-1"}`);
  const sent = await s.client.emails.send({ ...email, cc: [], headers: {}, html: "", replyTo: undefined, idempotencyKey: "welcome 42" });
  assert.deepEqual(sent, { id: "msg-1", suppressed: [] });
  const got = s.seen[0];
  assert.deepEqual([got?.method, got?.path, got?.idem, got?.contentType], ["POST", "/emails", "welcome 42", "application/json"]);
  assert.equal(got?.body, `{"from":"a@example.com","to":["b@example.org"],"subject":"s","text":"t"}`);
  // Everything an email can say, under the server's names.
  await s.client.emails.send({
    from: "App <a@example.com>",
    to: ["b@example.org", "c@example.org"],
    cc: ["d@example.org"],
    bcc: ["e@example.org"],
    replyTo: "help@example.com",
    subject: "s",
    html: "<p>h & more</p>",
    headers: { "X-Run": "7" },
    attachments: [
      { filename: "a.txt", content: new Uint8Array([104, 105]) },
      { filename: "logo.png", content: Buffer.from("png").subarray(1), contentType: "image/png", contentId: "logo" },
    ],
  });
  assert.deepEqual(JSON.parse(s.seen[1]?.body ?? ""), {
    from: "App <a@example.com>",
    to: ["b@example.org", "c@example.org"],
    cc: ["d@example.org"],
    bcc: ["e@example.org"],
    reply_to: "help@example.com",
    subject: "s",
    html: "<p>h & more</p>",
    headers: { "X-Run": "7" },
    attachments: [
      { filename: "a.txt", content: "aGk=" },
      { filename: "logo.png", content: "bmc=", content_type: "image/png", content_id: "logo" },
    ],
  });
  assert.equal(s.seen[1]?.idem, "");
});

test("an email to several says who was left out", async (t) => {
  const s = await serve(t, 200, `{"id":"msg-1","suppressed":["c@example.org"]}`);
  assert.deepEqual((await s.client.emails.send(email)).suppressed, ["c@example.org"]);
});

test("an answer that is not CairnPost's is not a send", async (t) => {
  for (const body of [`{}`, `{"id":""}`, `{"id":7}`, `[]`, `null`, `"msg-1"`, `{"id":"m","scheduled_at":"2030-01-01T00:00:00Z"}`, `{"id":"m","suppressed":"all"}`]) {
    const s = await serve(t, 200, body);
    const err = await thrown(() => s.client.emails.send(email));
    assert.ok(err instanceof TransportError && err.reason === "not_cairnpost" && mayHaveSent(err), body);
  }
});

test("an idempotency key a header cannot carry is refused, and nothing is sent", async (t) => {
  const s = await serve(t, 200, `{"id":"msg-1"}`);
  for (const bad of ["a\nb", " a", "a ", "a\x00", "é"]) {
    assert.ok((await thrown(() => s.client.emails.send({ ...email, idempotencyKey: bad }))) instanceof TypeError);
    assert.ok((await thrown(() => s.client.emails.sendBatch({ emails: [email], idempotencyKey: bad }))) instanceof TypeError);
  }
  assert.equal(s.seen.length, 0);
});

test("an email asked for later waits, and is cancelled and moved", async (t) => {
  const at = new Date("2030-01-02T03:04:05.678Z");
  const s = await serving(t, (res, n) => (n === 1 ? res.end(`{"id":"msg-1","scheduled_at":"2030-01-02T03:04:05.678Z"}`) : res.writeHead(n === 4 ? 409 : 200).end(n === 4 ? `{"name":"not_scheduled","message":"It was sent."}` : n === 2 ? `{"id":"msg-1","state":"cancelled"}` : `{"id":"msg-1","scheduled_at":"2030-02-01T00:00:00Z"}`)));
  const sent = await s.client.emails.send({ ...email, scheduledAt: at });
  assert.equal(sent.scheduledAt?.getTime(), at.getTime());
  assert.equal(JSON.parse(s.seen[0]?.body ?? "").scheduled_at, "2030-01-02T03:04:05.678Z");
  await s.client.emails.cancel("msg-1");
  await s.client.emails.reschedule("msg-1", new Date("2030-02-01T00:00:00Z"));
  assert.deepEqual([s.seen[1]?.method, s.seen[1]?.path, s.seen[1]?.body], ["POST", "/emails/msg-1/cancel", ""]);
  assert.deepEqual([s.seen[2]?.method, s.seen[2]?.path, s.seen[2]?.body], ["PATCH", "/emails/msg-1", `{"scheduled_at":"2030-02-01T00:00:00.000Z"}`]);
  const gone = await thrown(() => s.client.emails.cancel("msg-1"));
  assert.ok(gone instanceof CairnPostError && gone.code === ErrorCode.notScheduled && !gone.retryable);
  // A time that is none is not sent to the server.
  assert.ok((await thrown(() => s.client.emails.reschedule("msg-1", new Date("never")))) instanceof TypeError);
  assert.ok((await thrown(() => s.client.emails.send({ ...email, scheduledAt: new Date(NaN) }))) instanceof TypeError);
  assert.equal(s.seen.length, 4);
  // Anything else that says "fine" is not CairnPost saying it was done.
  for (const body of ["", "{}", "<html>maintenance</html>", `{"state":"cancelled"}`]) {
    const other = await serve(t, 200, body);
    assert.ok((await thrown(() => other.client.emails.cancel("msg-1"))) instanceof TransportError, body);
    assert.ok((await thrown(() => other.client.emails.reschedule("msg-1", at))) instanceof TransportError, body);
  }
  // One sent now that is said to wait is not CairnPost's answer.
  const odd = await serve(t, 200, `{"id":"msg-1"}`);
  assert.ok((await thrown(() => odd.client.emails.send({ ...email, scheduledAt: at }))) instanceof TransportError);
});

const record = `{"id":"msg 1","from":"a@example.com","to":"b@example.org","state":"bounced",
  "recipients":[{"address":"b@example.org","kind":"to","state":"bounced","updated_at":"2030-01-01T00:00:02.123456789Z"},
                {"address":"c@example.org","kind":"cc","state":"delivered","updated_at":"2030-01-01T02:00:03+02:00"}],
  "suppressed":["d@example.org"],"created_at":"2030-01-01T00:00:00Z","updated_at":"2030-01-01T00:00:03Z",
  "events":[{"type":"bounced","at":"2030-01-01T00:00:02Z","to":"b@example.org","permanent":true,"code":"5.1.1","reason":"permanent_failure","detail":"No such user"}],
  "content":{"subject":"s","text":"t","headers":{"X-Run":"7","__proto__":"x"},"kept_until":"2030-01-02T00:00:00Z",
    "attachments":[{"filename":"a.txt","content_type":"text/plain","size":2,"kept":true},{"filename":"b.png","content_type":"image/png","content_id":"b","size":3}]}}`;

test("get reads a record, each address of it, and escapes the id", async (t) => {
  const s = await serve(t, 200, record);
  const m = await s.client.emails.get("msg 1/../x?y");
  assert.equal(s.seen[0]?.path, "/emails/msg%201%2F..%2Fx%3Fy");
  assert.equal(m.state, State.bounced);
  assert.deepEqual(m.recipients.map((r) => [r.address, r.kind, r.state]), [["b@example.org", "to", "bounced"], ["c@example.org", "cc", "delivered"]]);
  // A time with nine digits after the second, and one in another zone.
  assert.equal(m.recipients[0]?.updatedAt.toISOString(), "2030-01-01T00:00:02.123Z");
  assert.equal(m.recipients[1]?.updatedAt.toISOString(), "2030-01-01T00:00:03.000Z");
  assert.deepEqual(m.suppressed, ["d@example.org"]);
  assert.deepEqual(m.events[0], { type: "bounced", at: new Date("2030-01-01T00:00:02Z"), to: "b@example.org", permanent: true, code: "5.1.1", reason: "permanent_failure", detail: "No such user" });
  assert.equal(m.scheduledAt, undefined);
  assert.ok(!("scheduledAt" in m) && !("reason" in m));
  assert.deepEqual(m.content?.attachments, [
    { filename: "a.txt", contentType: "text/plain", size: 2, kept: true },
    { filename: "b.png", contentType: "image/png", contentId: "b", size: 3, kept: false },
  ]);
  // A header named as a part of every object stays a header.
  assert.deepEqual(Object.keys(m.content?.headers ?? {}), ["X-Run", "__proto__"]);
  assert.equal(Object.getPrototypeOf(m.content?.headers), Object.prototype);
  for (const body of [`{}`, `{"id":"m","created_at":"yesterday","updated_at":"2030-01-01T00:00:00Z"}`, `{"id":"m","created_at":"2030-01-01","updated_at":"2030-01-01T00:00:00Z"}`, `{"id":"m","created_at":"2030-01-01T00:00:00Z","updated_at":"2030-01-01T00:00:00Z","recipients":{}}`]) {
    const odd = await serve(t, 200, body);
    assert.ok((await thrown(() => odd.client.emails.get("m"))) instanceof TransportError, body);
  }
});

test("a waiting email is read as one", async (t) => {
  const s = await serve(t, 200, `{"id":"m","state":"cancelled","scheduled_at":"2030-01-05T00:00:00Z","reason":"key_revoked","created_at":"2030-01-01T00:00:00Z","updated_at":"2030-01-01T00:00:00Z"}`);
  const m = await s.client.emails.get("m");
  assert.deepEqual([m.state, m.reason, m.scheduledAt?.toISOString(), m.recipients, m.events], [State.cancelled, "key_revoked", "2030-01-05T00:00:00.000Z", [], []]);
});

test("a kept file is read back, and one that is not kept is not found", async (t) => {
  const bytes = Buffer.from([0, 255, 10, 13]);
  const s = await serving(t, (res, n) => {
    if (n === 1) return void res.writeHead(200, { "content-type": "application/octet-stream" }).end(bytes);
    if (n === 2) return void res.writeHead(404).end(`{"name":"not_found","message":"No file."}`);
    res.writeHead(200, { "content-type": "text/html" }).end("<html>");
  });
  assert.deepEqual(Buffer.from(await s.client.emails.file("m", 2)), bytes);
  assert.equal(s.seen[0]?.path, "/emails/m/attachments/2");
  assert.ok(isNotFound(await thrown(() => s.client.emails.file("m", 1))));
  // Anything else that answers 200 there is not a CairnPost server.
  assert.ok((await thrown(() => s.client.emails.file("m", 1))) instanceof TransportError);
  for (const place of [0, -1, 1.5, NaN]) assert.ok((await thrown(() => s.client.emails.file("m", place))) instanceof TypeError);
  assert.equal(s.seen.length, 3);
});

test("a batch answers each email in its place", async (t) => {
  const at = new Date("2030-01-02T00:00:00Z");
  const s = await serve(t, 207, `{"data":[{"id":"m1","suppressed":["x@example.org"]},
    {"error":{"statusCode":429,"name":"rate_limit_exceeded","message":"Limit.","id":"m2","retry_after":30}},
    {"id":"m3","scheduled_at":"2030-01-02T00:00:00Z"},
    {"error":{"statusCode":503,"name":"not_started","message":"Its turn did not come."}},
    {"error":{"statusCode":502,"name":"SomethingNew","message":"SUBJECTMARK","id":"m5"}}]}`);
  const results = await s.client.emails.sendBatch({ emails: [email, email, { ...email, scheduledAt: at }, email, email], idempotencyKey: "run-1" });
  assert.equal(s.seen[0]?.path, "/emails/batch");
  assert.equal(s.seen[0]?.idem, "run-1");
  assert.equal(JSON.parse(s.seen[0]?.body ?? "").length, 5);
  assert.deepEqual(results[0]?.sent, { id: "m1", suppressed: ["x@example.org"] });
  assert.deepEqual(results[2]?.sent, { id: "m3", suppressed: [], scheduledAt: at });
  const limited = results[1]?.error;
  assert.deepEqual([limited?.status, limited?.code, limited?.emailId, limited?.retryAfterMs, limited?.retryable], [429, "rate_limit_exceeded", "m2", 30_000, true]);
  // An email whose turn did not come was not sent.
  assert.ok(results[3]?.error?.code === ErrorCode.notStarted && !mayHaveSent(results[3].error));
  // An error this client does not know is one email's, by its status alone.
  const unknown = results[4]?.error;
  assert.deepEqual([unknown?.status, unknown?.code, unknown?.detail, unknown?.emailId, mayHaveSent(unknown)], [502, undefined, undefined, undefined, true]);
  assert.equal(failed(results), 3);
});

// The answer is held to what was asked, not to what the caller's list
// has become while the call was made.
test("a batch changed while it is sent is read as it was asked", async (t) => {
  const s = await serve(t, 200, `{"data":[{"id":"m1"}]}`);
  const queue = [email];
  const one = { ...email } as { scheduledAt?: Date } & typeof email;
  const [results, sent] = await Promise.all([s.client.emails.sendBatch({ emails: queue }), (await serve(t, 200, `{"id":"m1"}`)).client.emails.send(one), queue.push(email), (one.scheduledAt = new Date(Date.now() + 1000))]);
  assert.deepEqual([results.length, sent.id], [1, "m1"]);
});

test("a batch refused whole is an error, and one with a key on an email is not sent", async (t) => {
  const s = await serve(t, 422, `{"statusCode":422,"name":"validation_error","message":"Email 2 has no subject."}`);
  const err = await thrown(() => s.client.emails.sendBatch({ emails: [email, email] }));
  assert.ok(err instanceof CairnPostError && err.status === 422 && !mayHaveSent(err));
  const own = await thrown(() => s.client.emails.sendBatch({ emails: [email, { ...email, idempotencyKey: "IDEMMARK" }] }));
  assert.ok(own instanceof TypeError && /email 2/.test(own.message) && !own.message.includes("IDEMMARK"));
  assert.equal(s.seen.length, 1);
});

test("a batch answer that is not CairnPost's is not trusted", async (t) => {
  for (const body of [`{"data":[{"id":"m1"}]}`, `{"data":[{"id":"m1"},{}]}`, `{"data":[{"id":"m1"},{"error":{"statusCode":200,"name":"validation_error"}}]}`, `{"data":[{"id":"m1"},{"error":"no"}]}`, `{"data":[{"id":"m1"},{"id":"m2","scheduled_at":"2030-01-01T00:00:00Z"}]}`, `{}`]) {
    const s = await serve(t, 200, body);
    const err = await thrown(() => s.client.emails.sendBatch({ emails: [email, email] }));
    assert.ok(err instanceof TransportError && mayHaveSent(err), body);
  }
});

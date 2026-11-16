import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { CairnPost, DeliveryState, ErrorCode, EventType, isNotFound, isWrongAddress, NotCapturingError, Verifier, type WebhookEvent, WebhookError } from "../../src/index.ts";
import { admin, code, inboundSecret, run, url } from "./live.ts";

/** A receiver on this machine: it keeps each request it was sent. */
async function receiver(t: { after(fn: () => void): void }, status: () => number) {
  const got: { headers: http.IncomingHttpHeaders; body: Buffer }[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      got.push({ headers: req.headers, body: Buffer.concat(chunks) });
      res.writeHead(status()).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => void server.close());
  return { got, at: `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook/${run}` };
}

async function until<T>(what: string, look: () => T | undefined | Promise<T | undefined>): Promise<T> {
  for (let n = 0; n < 100; n++) {
    const found = await look();
    if (found !== undefined) return found;
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error(`waited ten seconds for ${what}`);
}

test("webhooks against a real server", async (t) => {
  let answer = 204;
  const r = await receiver(t, () => answer);
  const made = await admin.webhooks.create({ url: r.at, events: [EventType.received], description: run });
  t.after(() => admin.webhooks.delete(made.id).catch(() => {}));
  assert.ok(made.secret?.startsWith("whsec_") && made.enabled && made.pausedAt === undefined);
  assert.equal((await admin.webhooks.get(made.id)).secret, undefined, "the secret is said once");
  assert.ok((await admin.webhooks.list()).some((w) => w.id === made.id && w.description === run));

  // A webhook sent to try it out arrives signed, and the verifier takes it.
  assert.deepEqual(await admin.webhooks.test(made.id), { delivered: true, status: 204 });
  const verifier = new Verifier(made.secret ?? "");
  const tried = verifier.verify(r.got[0]!.headers, r.got[0]!.body);
  assert.deepEqual([tried.type, tried.email], [EventType.test, undefined]);
  assert.ok(Math.abs(tried.at.getTime() - Date.now()) < 60_000);
  assert.throws(() => verifier.verify(r.got[0]!.headers, Buffer.concat([r.got[0]!.body, Buffer.from(" ")])), WebhookError);
  answer = 500;
  assert.deepEqual(await admin.webhooks.test(made.id), { delivered: false, status: 500, failure: "status" });
  answer = 204;

  // A new secret: the old one still signs for a time, so both verify.
  const rotated = await admin.webhooks.rotateSecret(made.id);
  assert.ok(rotated.secret && rotated.secret !== made.secret && rotated.previousSecretUntil && rotated.previousSecretUntil > new Date());
  await admin.webhooks.test(made.id);
  const last = r.got.at(-1)!;
  assert.equal(verifier.verify(last.headers, last.body).type, EventType.test);
  assert.equal(new Verifier(rotated.secret).verify(last.headers, last.body).type, EventType.test);

  const off = await admin.webhooks.update(made.id, { enabled: false, events: [] });
  assert.deepEqual([off.enabled, off.events, off.url, off.description], [false, [], r.at, run]);
  const on = await admin.webhooks.update(made.id, { enabled: true, events: [EventType.received], description: "" });
  assert.deepEqual([on.enabled, on.events, on.description], [true, [EventType.received], undefined]);
  assert.equal((await admin.webhooks.resume(made.id)).pausedAt, undefined, "one that is not paused is answered as it is");

  // An email that comes for an address is told to the endpoint, and read.
  const raw = Buffer.from(`From: Ana <ana@example.org>\r\nTo: help@${run}.example.com\r\nSubject: =?utf-8?q?H=C3=A9llo?= ${run}\r\nDate: Tue, 01 Jan 2030 00:00:00 +0000\r\nMessage-ID: <1@example.org>\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=b\r\n\r\n--b\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nhello\r\n--b\r\nContent-Type: application/octet-stream\r\nContent-Disposition: attachment; filename=a.bin\r\nContent-Transfer-Encoding: base64\r\n\r\nAAH/\r\n--b--\r\n`);
  answer = 500; // the first try fails, so that there is one to try again
  const took = await handOver(raw, `help@${run}.example.com`, "ana@example.org");
  assert.ok(took >= 200 && took <= 299, `the server answered ${took} to an email handed over`);
  const told = await until("the webhook about the email that came", () => {
    const events = r.got.slice(3).map((g): WebhookEvent => new Verifier(rotated.secret ?? "").verify(g.headers, g.body));
    return events.find((e) => e.type === EventType.received);
  });
  assert.deepEqual([told.email, told.received?.from, told.received?.to], [undefined, "ana@example.org", [`help@${run}.example.com`]]);
  const id = told.received?.id ?? "";
  const got = await admin.received.get(id);
  assert.deepEqual([got.to, got.from, got.size, got.content?.subject, got.content?.from, got.content?.text?.trim(), got.content?.messageId, got.content?.date?.toISOString(), got.content?.partial],
    [`help@${run}.example.com`, "ana@example.org", raw.length, `Héllo ${run}`, "Ana <ana@example.org>", "hello", "<1@example.org>", "2030-01-01T00:00:00.000Z", false]);
  assert.deepEqual(got.content?.attachments.map((f) => [f.filename, f.size]), [["a.bin", 3]]);
  assert.deepEqual(Buffer.from(await admin.received.raw(id)), raw);
  assert.deepEqual(Buffer.from(await admin.received.file(id, 1)), Buffer.from([0, 1, 255]));
  const listed: string[] = [];
  for await (const item of admin.received.all()) listed.push(item.id);
  assert.ok(listed.includes(id) && (await admin.received.list({ limit: 1 })).data.length === 1);

  // The try that failed is on record, is tried again when asked, and then delivered.
  const owed = await until("the failed try on record", async () => (await admin.webhooks.deliveries(made.id, { state: DeliveryState.pending })).data.find((d) => d.inboundId === id && d.attempts > 0));
  assert.deepEqual([owed.id, owed.type, owed.emailId, owed.lastStatus, owed.lastFailure, owed.nextAttemptAt !== undefined], [told.id, EventType.received, undefined, 500, "status", true]);
  answer = 204;
  await admin.webhooks.retryDelivery(made.id, owed.id);
  const delivered = await until("the delivery, once taken", async () => {
    for await (const d of admin.webhooks.allDeliveries(made.id, DeliveryState.delivered)) if (d.id === owed.id) return d;
    return undefined;
  });
  assert.deepEqual([delivered.attempts, delivered.lastStatus, delivered.deliveredAt !== undefined], [2, 204, true]);
  assert.equal(r.got.filter((g) => g.headers["webhook-id"] === told.id).length, 2, "the same webhook, under the same id, twice");
  assert.ok(isNotFound(await admin.webhooks.retryDelivery(made.id, "0199-none").catch((err: unknown) => err)));

  await admin.received.delete(id);
  assert.ok(isNotFound(await admin.received.get(id).catch((err: unknown) => err)));
  await admin.webhooks.delete(made.id);
  assert.ok(isNotFound(await admin.webhooks.get(made.id).catch((err: unknown) => err)));
});

test("a wrong address is said to be one", async () => {
  const astray = new CairnPost(url.replace(/\/+$/, "") + "/not-the-server", process.env["CAIRNPOST_ADMIN_KEY"] ?? "");
  for (const call of [() => astray.health(), () => astray.emails.get("0199"), () => astray.captured(), () => astray.webhooks.list()]) {
    const err = await call().catch((e: unknown) => e);
    assert.ok(isWrongAddress(err) && !isNotFound(err) && !(err instanceof NotCapturingError), String(err));
  }
  assert.equal(await code(() => astray.emails.get("0199")), ErrorCode.routeNotFound);
});

/** Hands an email to the server as the Worker it ships does, signed. */
async function handOver(raw: Buffer, to: string, from: string): Promise<number> {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const digest = createHash("sha256").update(raw).digest("hex");
  const mac = createHmac("sha256", inboundSecret);
  for (const part of [timestamp, to, from, digest]) {
    const length = Buffer.alloc(8);
    length.writeBigUInt64BE(BigInt(Buffer.byteLength(part)));
    mac.update(length).update(part);
  }
  const res = await fetch(url.replace(/\/+$/, "") + "/inbound", {
    method: "POST",
    headers: { "content-type": "message/rfc822", "x-cairnpost-timestamp": timestamp, "x-cairnpost-to": to, "x-cairnpost-from": from, "x-cairnpost-digest": digest, "x-cairnpost-signature": "v1=" + mac.digest("hex") },
    body: raw,
  });
  return res.status;
}

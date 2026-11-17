import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { BounceType, defaultToleranceMs, EventType, Reason, type RequestHeaders, Verifier, WebhookError, type WebhookRefusal } from "../src/index.ts";

const bounce =
  `{"type":"email.bounced","created_at":"2030-01-01T00:00:05Z","data":{"email_id":"m1","from":"app@example.com",` +
  `"to":["gone@example.org"],"created_at":"2030-01-01T00:00:00Z","code":"5.1.1","reason":"permanent_failure",` +
  `"bounce":{"type":"Permanent"},"suppressed":true}}`;

const signingKey = Buffer.from("a signing key of thirty-two bytes");
const secret = "whsec_" + signingKey.toString("base64");
const at = Date.UTC(2030, 0, 1, 0, 0, 10);

/** What a sender holding the key would put in the header. */
function signature(k: Buffer | string, id: string, when: number, body: string): string {
  return "v1," + createHmac("sha256", k).update(`${id}.${Math.floor(when / 1000)}.${body}`).digest("base64");
}

function headers(prefix: string, id: string, when: number, sig: string): Record<string, string> {
  return { [prefix + "id"]: id, [prefix + "timestamp"]: String(Math.floor(when / 1000)), [prefix + "signature"]: sig };
}

const verifier = (toleranceMs?: number) => new Verifier(secret, { now: () => at, toleranceMs });

function refused(run: () => unknown): WebhookRefusal | "taken" {
  try {
    run();
  } catch (err) {
    assert.ok(err instanceof WebhookError, String(err));
    return err.reason;
  }
  return "taken";
}

test("a webhook signed by the endpoint's secret is read", () => {
  const v = verifier();
  for (const prefix of ["webhook-", "svix-"]) {
    const e = v.verify(headers(prefix, "dlv-1", at, signature(signingKey, "dlv-1", at, bounce)), bounce);
    assert.deepEqual(e, {
      id: "dlv-1",
      type: EventType.bounced,
      at: new Date("2030-01-01T00:00:05Z"),
      email: { id: "m1", from: "app@example.com", to: ["gone@example.org"], createdAt: new Date("2030-01-01T00:00:00Z"), code: "5.1.1", reason: "permanent_failure", bounce: { type: BounceType.permanent }, suppressed: true },
    });
  }
  // The body as bytes, a part of a larger buffer; the headers as fetch and as node:http give them.
  const padded = Buffer.concat([Buffer.from("xx"), Buffer.from(bounce), Buffer.from("yy")]);
  const body = padded.subarray(2, padded.length - 2);
  const good = signature(signingKey, "dlv-1", at, bounce);
  const shapes: RequestHeaders[] = [
    new Headers(headers("Webhook-", "dlv-1", at, good)),
    { "Webhook-Id": "dlv-1", "WEBHOOK-TIMESTAMP": [String(at / 1000)], "webhook-signature": ` ${good} ` },
  ];
  for (const shape of shapes) assert.equal(v.verify(shape, body).email?.id, "m1");
  // One of several signatures is enough: a secret being changed over is signed with both.
  const other = signature("another key", "dlv-1", at, bounce);
  for (const both of [`${other} v2,zzz ${good}`, `${good} ${other}`]) v.verify(headers("svix-", "dlv-1", at, both), bounce);
  // The test webhook is about no email, and a type not known is passed on.
  const tried = `{"type":"webhook.test","created_at":"2030-01-01T00:00:05Z","data":{}}`;
  const opened = `{"type":"email.opened","created_at":"2030-01-01T00:00:05Z","data":{"email_id":"m","to":["a@example.org"]}}`;
  assert.deepEqual(v.verify(headers("webhook-", "t", at, signature(signingKey, "t", at, tried)), tried), { id: "t", type: EventType.test, at: new Date("2030-01-01T00:00:05Z") });
  const passed = v.verify(headers("webhook-", "t", at, signature(signingKey, "t", at, opened)), opened);
  assert.deepEqual([passed.type, passed.email?.id], ["email.opened", "m"]);
  // Also one that starts with "email." and is about no email that was sent.
  const forwarded = `{"type":"email.forwarded","created_at":"2030-01-01T00:00:05Z","data":{"inbound_id":"in-1"}}`;
  assert.deepEqual(v.verify(headers("webhook-", "t", at, signature(signingKey, "t", at, forwarded)), new TextEncoder().encode(forwarded).buffer as ArrayBuffer), { id: "t", type: "email.forwarded", at: new Date("2030-01-01T00:00:05Z") });
  // A call that is itself wrong is said as that, not as a forged webhook.
  const good2 = headers("webhook-", "dlv-1", at, good);
  for (const wrong of [undefined, null, JSON.parse(bounce), 7]) assert.throws(() => v.verify(good2, wrong as string), TypeError);
  assert.throws(() => v.verify(undefined as unknown as RequestHeaders, bounce), TypeError);
});

test("what is not the endpoint's is refused", () => {
  const v = verifier();
  const good = signature(signingKey, "dlv-1", at, bounce);
  const late = at - defaultToleranceMs - 1000;
  const early = at + defaultToleranceMs + 1000;
  const cases: [why: string, h: Record<string, string>, body: string, want: WebhookRefusal][] = [
    ["another key", headers("webhook-", "dlv-1", at, signature("another key", "dlv-1", at, bounce)), bounce, "signature"],
    ["a changed body", headers("webhook-", "dlv-1", at, good), bounce + " ", "signature"],
    ["another id", headers("webhook-", "dlv-2", at, good), bounce, "signature"],
    ["a moved timestamp", headers("webhook-", "dlv-1", at + 1000, good), bounce, "signature"],
    ["an old webhook", headers("webhook-", "dlv-1", late, signature(signingKey, "dlv-1", late, bounce)), bounce, "stale"],
    ["one from the future", headers("webhook-", "dlv-1", early, signature(signingKey, "dlv-1", early, bounce)), bounce, "stale"],
    ["no headers", {}, bounce, "unsigned"],
    ["a time that is none", { "webhook-id": "a", "webhook-timestamp": "now", "webhook-signature": good }, bounce, "unsigned"],
    ["a time in another form", { "webhook-id": "a", "webhook-timestamp": "1.89e9", "webhook-signature": good }, bounce, "unsigned"],
    ["a signature of no use", headers("webhook-", "dlv-1", at, "v1,not base64!"), bounce, "signature"],
    ["a signature cut short", headers("webhook-", "dlv-1", at, good.slice(0, -5)), bounce, "signature"],
    ["a signature with more after it", headers("webhook-", "dlv-1", at, good + "!!"), bounce, "signature"],
    ["a signature under another version", headers("webhook-", "dlv-1", at, good.replace("v1,", "v2,")), bounce, "signature"],
    ["signed, not a webhook", headers("webhook-", "x", at, signature(signingKey, "x", at, "hello")), "hello", "payload"],
    ["signed, a list", headers("webhook-", "x", at, signature(signingKey, "x", at, "[]")), "[]", "payload"],
  ];
  for (const [why, h, body, want] of cases) assert.equal(refused(() => v.verify(h, body)), want, why);
  // Within the tolerance either way is taken, and the tolerance can be set.
  const edge = at - defaultToleranceMs;
  const atEdge = headers("webhook-", "e", edge, signature(signingKey, "e", edge, bounce));
  assert.equal(refused(() => v.verify(atEdge, bounce)), "taken");
  assert.equal(refused(() => verifier(1000).verify(atEdge, bounce)), "stale");
  // Signed, about an email, and not saying which or when: refused, not handed on with nothing in it.
  const stamp = `"created_at":"2030-01-01T00:00:05Z"`;
  const which = `"email_id":"m","to":["a@example.org"],${stamp}`;
  const sign = (body: string) => headers("webhook-", "p", at, signature(signingKey, "p", at, body));
  for (const body of [
    `{"type":"email.bounced",${stamp}}`,
    `{"type":"email.bounced",${stamp},"data":{"email_id":"m","to":"a@example.org",${stamp},"bounce":{"type":"Permanent"}}}`,
    `{"type":"email.bounced",${stamp},"data":{${which}}}`,
    `{"type":"email.bounced",${stamp},"data":{${which},"bounce":{}}}`,
    `{"type":"email.bounced",${stamp},"data":{${which},"bounce":{"type":""}}}`,
    `{"type":"email.delivered",${stamp},"data":{"email_id":"m","to":[],${stamp}}}`,
    `{"type":"email.delivered",${stamp},"data":{"to":["a@example.org"],${stamp}}}`,
    `{"type":"email.delivered",${stamp},"data":{"email_id":"m","to":["a@example.org"]}}`,
    `{"type":"email.delivered",${stamp},"data":{"email_id":"m","to":["a@example.org"],"created_at":"yesterday"}}`,
    // A time that was never set, as a server in Go writes one.
    `{"type":"email.delivered",${stamp},"data":{"email_id":"m","to":["a@example.org"],"created_at":"0001-01-01T00:00:00Z"}}`,
    `{"type":"email.delivered","created_at":"0001-01-01T00:00:00Z","data":{${which}}}`,
    `{"type":"email.delivered","data":{${which}}}`,
    `{${stamp},"data":{${which}}}`,
  ]) {
    assert.equal(refused(() => v.verify(sign(body), body)), "payload", body);
  }
  // Each of those is whole with what it lacked.
  for (const type of ["email.delivered", "email.delivery_delayed", "email.complained", "email.failed"]) {
    const body = `{"type":"${type}",${stamp},"data":{${which}}}`;
    assert.deepEqual(v.verify(sign(body), body).email?.createdAt, new Date("2030-01-01T00:00:05Z"), type);
  }
  // No secret, no verifier: nothing signed with no key at all is ever taken.
  for (const bad of ["", "c2VjcmV0", "whsec_", "whsec_not base64!", "whsec_c2VjcmV0!", undefined as unknown as string]) {
    assert.equal(refused(() => new Verifier(bad)), "secret", String(bad));
  }
  assert.equal(refused(() => new Verifier(` ${secret}\n`)), "taken");
});

test("a suppression told on its own is read", () => {
  const v = verifier();
  const body = `{"type":"address.suppressed","created_at":"2030-01-01T00:00:00Z","data":{"domain":"example.com","address":"ana@example.org","reason":"bounce"}}`;
  const e = v.verify(headers("webhook-", "dlv-1", at, signature(signingKey, "dlv-1", at, body)), body);
  assert.deepEqual([e.type, e.email, e.suppression], [EventType.addressSuppressed, undefined, { domain: "example.com", address: "ana@example.org", reason: Reason.bounce }]);
  for (const data of [`{}`, `{"domain":"example.com"}`, `{"domain":"example.com","address":"ana@example.org"}`]) {
    const without = `{"type":"address.suppressed","created_at":"2030-01-01T00:00:00Z","data":${data}}`;
    assert.equal(refused(() => v.verify(headers("webhook-", "dlv-2", at, signature(signingKey, "dlv-2", at, without)), without)), "payload", data);
  }
});

test("an email that came is told by its own event", () => {
  const v = verifier();
  const body = `{"type":"email.received","created_at":"2030-01-01T00:00:00Z","data":{"inbound_id":"in-1","from":"","to":["help@example.com"],"received_at":"2030-01-01T00:00:00Z"}}`;
  const e = v.verify(headers("webhook-", "dlv-1", at, signature(signingKey, "dlv-1", at, body)), body);
  assert.deepEqual([e.email, e.received], [undefined, { id: "in-1", from: "", to: ["help@example.com"], receivedAt: new Date("2030-01-01T00:00:00Z") }]);
  // One that does not say which, for whom or when is refused.
  for (const data of [
    `{"from":"a@example.org","to":["help@example.com"],"received_at":"2030-01-01T00:00:00Z"}`,
    `{"inbound_id":"in-1","from":"a@example.org","to":[],"received_at":"2030-01-01T00:00:00Z"}`,
    `{"inbound_id":"in-1","from":"a@example.org","to":["help@example.com"]}`,
    `{"inbound_id":"in-1","from":"a@example.org","to":["help@example.com"],"received_at":"0001-01-01T00:00:00Z"}`,
  ]) {
    const without = `{"type":"email.received","created_at":"2030-01-01T00:00:00Z","data":${data}}`;
    assert.equal(refused(() => v.verify(headers("webhook-", "dlv-1", at, signature(signingKey, "dlv-1", at, without)), without)), "payload", data);
  }
});

import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { type RequestHeaders, Verifier, WebhookError } from "../src/index.ts";

// Which webhooks are read and which refused is in the shared cases
// (cases-webhooks.test.ts). What follows is this client's own: the
// shapes a body and its headers come in here, and a call that is itself
// wrong.

const bounce =
  `{"type":"email.bounced","created_at":"2030-01-01T00:00:05Z","data":{"email_id":"m1","from":"app@example.com",` +
  `"to":["gone@example.org"],"created_at":"2030-01-01T00:00:00Z","code":"5.1.1","reason":"permanent_failure",` +
  `"bounce":{"type":"Permanent"},"suppressed":true}}`;

const signingKey = Buffer.from("a signing key of thirty-two bytes");
const secret = "whsec_" + signingKey.toString("base64");
const at = Date.UTC(2030, 0, 1, 0, 0, 10);

/** What a sender holding the key would put in the header. */
function signature(id: string, body: string): string {
  return "v1," + createHmac("sha256", signingKey).update(`${id}.${at / 1000}.${body}`).digest("base64");
}

function headers(prefix: string, id: string, sig: string): Record<string, string> {
  return { [prefix + "id"]: id, [prefix + "timestamp"]: String(at / 1000), [prefix + "signature"]: sig };
}

const v = new Verifier(secret, { now: () => at });
const good = signature("dlv-1", bounce);

test("a body is read as bytes or as text, and headers as fetch and as node:http give them", () => {
  // The body as bytes, a part of a larger buffer.
  const padded = Buffer.concat([Buffer.from("xx"), Buffer.from(bounce), Buffer.from("yy")]);
  const body = padded.subarray(2, padded.length - 2);
  const shapes: RequestHeaders[] = [
    new Headers(headers("Webhook-", "dlv-1", good)),
    { "Webhook-Id": "dlv-1", "WEBHOOK-TIMESTAMP": [String(at / 1000)], "webhook-signature": ` ${good} ` },
  ];
  for (const shape of shapes) assert.equal(v.verify(shape, body).email?.id, "m1");
  const forwarded = `{"type":"email.forwarded","created_at":"2030-01-01T00:00:05Z","data":{"inbound_id":"in-1"}}`;
  const buffer = new TextEncoder().encode(forwarded).buffer as ArrayBuffer;
  assert.deepEqual(v.verify(headers("webhook-", "t", signature("t", forwarded)), buffer), { id: "t", type: "email.forwarded", at: new Date("2030-01-01T00:00:05Z") });
});

// A call that is itself wrong is said as that, not as a forged webhook.
test("a call that is wrong is a TypeError", () => {
  const ours = headers("webhook-", "dlv-1", good);
  for (const wrong of [undefined, null, JSON.parse(bounce), 7]) assert.throws(() => v.verify(ours, wrong as string), TypeError);
  assert.throws(() => v.verify(undefined as unknown as RequestHeaders, bounce), TypeError);
});

// No secret, no verifier: nothing signed with no key at all is ever taken.
test("a secret that is not text is refused", () => {
  assert.throws(() => new Verifier(undefined as unknown as string), (err) => err instanceof WebhookError && err.reason === "secret");
});

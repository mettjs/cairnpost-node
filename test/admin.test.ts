import assert from "node:assert/strict";
import { test } from "node:test";
import { CairnPostError, DeliveryState, ErrorCode, isWrongAddress, NotCapturingError, Reason, TransportError } from "../src/index.ts";
import { serve, serving, thrown, up } from "./stand.ts";

const day = `"created_at":"2030-01-01T00:00:00Z"`;

test("suppressions are paged and walked", async (t) => {
  const s = await serving(t, (res, n) =>
    res.end(n === 1
      ? `{"data":[{"domain":"example.com","address":"a@example.org","reason":"bounce","email_id":"m1",${day}}],"next":"cursor 1"}`
      : `{"data":[{"domain":"example.com","address":"b@example.org","reason":"manual","note":"asked",${day}}]}`),
  );
  const got: string[] = [];
  for await (const sup of s.client.suppressions.all("example.com")) got.push(`${sup.address}:${sup.reason}`);
  assert.deepEqual(got, ["a@example.org:bounce", "b@example.org:manual"]);
  assert.deepEqual(s.seen.map((r) => r.query), ["limit=200&domain=example.com", "limit=200&after=cursor+1&domain=example.com"]);
  const page = await s.client.suppressions.list({ limit: 5 });
  assert.deepEqual([page.data.length, page.next, s.seen[2]?.query], [1, undefined, "limit=5"]);
  assert.deepEqual(page.data[0], { domain: "example.com", address: "b@example.org", reason: "manual", note: "asked", createdAt: new Date("2030-01-01T00:00:00Z") });
  // A walk stops at the first error and says it.
  const refused = await serve(t, 403, `{"name":"admin_key_required","message":"Admin."}`);
  const err = await thrown(async () => {
    for await (const _ of refused.client.suppressions.all()) assert.fail("an item of a list that was refused");
  });
  assert.ok(err instanceof CairnPostError && err.code === ErrorCode.adminKeyRequired);
  assert.equal(refused.seen.length, 1);
});

test("a walk stops at a cursor that does not move", async (t) => {
  const s = await serve(t, 200, `{"data":[{"domain":"example.com","address":"a@example.org","reason":"bounce",${day}}],"next":"same"}`);
  let n = 0;
  for await (const _ of s.client.suppressions.all()) n++;
  assert.deepEqual([n, s.seen.length], [2, 2]);
});

test("suppress and lift", async (t) => {
  const s = await serving(t, (res, n) => {
    if (n === 1) return void res.writeHead(201).end(`{"domain":"example.com","address":"a@example.org","added":true}`);
    if (n === 2) return void res.end(`{"domain":"example.com","address":"a@example.org","added":false}`);
    res.end(n === 3 ? `{"lifted":1}` : `{"lifted":3}`);
  });
  assert.equal(await s.client.suppressions.add("example.com", "a@example.org", "asked"), true);
  assert.equal(await s.client.suppressions.add("example.com", "a@example.org"), false, "already there");
  await s.client.suppressions.lift("example.com", "a@example.org");
  assert.equal(await s.client.suppressions.liftAll("example.com", Reason.bounce), 3);
  assert.deepEqual(s.seen.map((r) => r.body), [
    `{"domain":"example.com","address":"a@example.org","note":"asked"}`,
    `{"domain":"example.com","address":"a@example.org"}`,
    `{"domain":"example.com","address":"a@example.org"}`,
    `{"domain":"example.com","all":true,"reason":"bounce"}`,
  ]);
  assert.deepEqual([s.seen[2]?.path, s.seen[3]?.path], ["/suppressions/lift", "/suppressions/lift"]);
});

const endpoint = `{"id":"wh-1","url":"https://app.example.com/hook","events":["email.bounced"],"enabled":true,${day}`;

test("webhooks and deliveries", async (t) => {
  const s = await serving(t, (res, n) => {
    const answers = [
      `${endpoint},"secret":"whsec_c2VjcmV0"}`,
      `{"data":[${endpoint}}]}`,
      `${endpoint}}`,
      ``,
      `{"delivered":false,"status":500,"failure":"status"}`,
      `{"data":[{"id":"dlv-1","email_id":"m1","type":"email.bounced","state":"failed","attempts":8,"last_status":500,"last_failure":"status",${day},"attempted_at":"2030-01-01T00:00:01Z"}],"next":"c2"}`,
      `{"data":[{"id":"dlv-2","inbound_id":"in-1","type":"email.received","state":"failed","attempts":1,${day}}]}`,
      `{"state":"pending"}`,
    ];
    res.writeHead(n === 1 ? 201 : n === 4 ? 204 : 200).end(answers[n - 1]);
  });
  const w = s.client.webhooks;
  const made = await w.create({ url: "https://app.example.com/hook", events: ["email.bounced"], description: "" });
  assert.deepEqual([made.id, made.secret, made.enabled, made.events, made.domain], ["wh-1", "whsec_c2VjcmV0", true, ["email.bounced"], undefined]);
  assert.equal(s.seen[0]?.body, `{"url":"https://app.example.com/hook","events":["email.bounced"]}`);
  assert.equal((await w.list()).length, 1);
  assert.equal((await w.get("wh-1")).secret, undefined);
  await w.delete("wh-1");
  assert.deepEqual(await w.test("wh-1"), { delivered: false, status: 500, failure: "status" });
  const ids: string[] = [];
  for await (const d of w.allDeliveries("wh-1", DeliveryState.failed)) ids.push(`${d.id}:${d.emailId ?? d.inboundId}:${d.lastStatus ?? "none"}`);
  assert.deepEqual(ids, ["dlv-1:m1:500", "dlv-2:in-1:none"]);
  await w.retryDelivery("wh-1", "dlv 1");
  assert.deepEqual(s.seen.map((r) => `${r.method} ${r.path}${r.query && "?" + r.query}`), [
    "POST /webhooks", "GET /webhooks", "GET /webhooks/wh-1", "DELETE /webhooks/wh-1", "POST /webhooks/wh-1/test",
    "GET /webhooks/wh-1/deliveries?limit=200&state=failed", "GET /webhooks/wh-1/deliveries?limit=200&after=c2&state=failed",
    "POST /webhooks/wh-1/deliveries/dlv%201/retry",
  ]);
});

test("a webhook change can switch off and clear, and leaves the rest alone", async (t) => {
  const s = await serve(t, 200, `${endpoint}}`);
  await s.client.webhooks.update("wh-1", { enabled: false, events: [], description: "" });
  await s.client.webhooks.update("wh-1", { url: "https://app.example.com/new" });
  assert.deepEqual(s.seen.map((r) => `${r.method} ${r.body}`), [`PATCH {"events":[],"description":"","enabled":false}`, `PATCH {"url":"https://app.example.com/new"}`]);
});

test("a secret is rotated, an endpoint resumed, and each says how it stands", async (t) => {
  const s = await serve(t, 200, `${endpoint},"secret":"whsec_bmV3","failing_since":"2030-01-02T00:00:00Z","paused_at":"2030-01-07T00:00:00Z","previous_secret_until":"2030-01-08T00:00:00Z"}`);
  const w = await s.client.webhooks.rotateSecret("wh-1");
  assert.deepEqual([w.secret, w.failingSince?.getUTCDate(), w.pausedAt?.getUTCDate(), w.previousSecretUntil?.getUTCDate()], ["whsec_bmV3", 2, 7, 8]);
  await s.client.webhooks.resume("wh-1");
  assert.deepEqual(s.seen.map((r) => `${r.method} ${r.path} ${r.body}`), ["POST /webhooks/wh-1/secret ", "POST /webhooks/wh-1/resume "]);
  // An answer that is no endpoint is refused.
  const odd = await serve(t, 200, `{"url":"https://app.example.com/hook"}`);
  assert.ok((await thrown(() => odd.client.webhooks.get("wh-1"))) instanceof TransportError);
});

const template = `{"id":"t-1","name":"welcome","subject":"Hello {{name}}","html":"<p>{{code}}</p>",
  "variables":[{"name":"name","default":"there","required":false},{"name":"code","required":true},{"name":"ps","default":"","required":false}],
  ${day},"updated_at":"2030-01-02T00:00:00Z"}`;

test("an email is sent from a template", async (t) => {
  const s = await serve(t, 200, `{"id":"msg-1"}`);
  await s.client.emails.send({ from: "app@example.com", to: ["ana@example.org"], template: { name: "welcome", variables: { code: "4821" } } });
  assert.equal(s.seen[0]?.body, `{"from":"app@example.com","to":["ana@example.org"],"subject":"","template":{"name":"welcome","variables":{"code":"4821"}}}`);
  const batch = await serve(t, 200, `{"data":[{"id":"msg-1"}]}`);
  await batch.client.emails.sendBatch({ emails: [{ from: "app@example.com", to: ["ana@example.org"], template: { name: "welcome" } }] });
  assert.equal(batch.seen[0]?.body, `[{"from":"app@example.com","to":["ana@example.org"],"subject":"","template":{"name":"welcome"}}]`);
});

test("templates are kept, read, changed and deleted", async (t) => {
  const s = await serve(t, 200, template);
  const made = await s.client.templates.create({ name: "welcome", subject: "Hello {{name}}", html: "<p>{{code}}</p>", defaults: { name: "there" } });
  assert.deepEqual(made.variables, [{ name: "name", default: "there", required: false }, { name: "code", required: true }, { name: "ps", default: "", required: false }]);
  assert.deepEqual([made.id, made.updatedAt.getUTCDate(), made.text, made.domain], ["t-1", 2, undefined, undefined]);
  assert.equal(s.seen[0]?.body, `{"name":"welcome","subject":"Hello {{name}}","html":"<p>{{code}}</p>","defaults":{"name":"there"}}`);
  await s.client.templates.get("a/b");
  await s.client.templates.update("t-1", { subject: "Hi", defaults: {} });
  assert.deepEqual([s.seen[1]?.path, s.seen[2]?.method, s.seen[2]?.body], ["/templates/a%2Fb", "PATCH", `{"subject":"Hi","defaults":{}}`]);
  const listed = await serve(t, 200, `{"data":[${template}],"more":true}`);
  const all = await listed.client.templates.list();
  assert.deepEqual([all.data.length, all.more, listed.seen[0]?.query], [1, true, ""]);
  await listed.client.templates.list("shop.example.com");
  assert.equal(listed.seen[1]?.query, "domain=shop.example.com");
  const gone = await serve(t, 204, "");
  await gone.client.templates.delete("t-1");
  assert.deepEqual([gone.seen[0]?.method, gone.seen[0]?.path], ["DELETE", "/templates/t-1"]);
  const taken = await serve(t, 409, `{"statusCode":409,"name":"name_taken","message":"A template of this name is already there."}`);
  const err = await thrown(() => taken.client.templates.create({ name: "welcome", subject: "s", text: "t" }));
  assert.ok(err instanceof CairnPostError && err.code === ErrorCode.nameTaken);
  const empty = await serve(t, 200, `{}`);
  assert.ok((await thrown(() => empty.client.templates.get("t-1"))) instanceof TransportError, "an empty answer was taken for a template");
});

test("a received email is read with what it says, and as it came", async (t) => {
  const one = `{"id":"in-1","to":"help@example.com","from":"ana@example.org","received_at":"2030-01-01T00:00:00Z","kept_until":"2030-01-08T00:00:00Z","size":512`;
  const raw = Buffer.from("From: ana@example.org\r\n\r\n\xff", "latin1");
  const s = await serving(t, (res, n) => {
    if (n === 1) return void res.end(`${one},"content":{"subject":"Hi","from":"Ana <ana@example.org>","to":["help@example.com"],"date":"2029-12-31T23:59:00Z","text":"hello","headers":[{"name":"Received","value":"x"},{"name":"Received","value":"y"}],"attachments":[{"filename":"a.pdf","content_type":"application/pdf","size":9}],"partial":true}}`);
    if (n === 2) return void res.end(`{"data":[${one}},{"id":"in-0","to":"help@example.com","received_at":"2030-01-01T00:00:00Z","kept_until":"2030-01-08T00:00:00Z","size":1}]}`);
    if (n === 3 || n === 4) return void res.writeHead(200, { "content-type": "application/octet-stream" }).end(raw);
    res.writeHead(204).end();
  });
  const r = s.client.received;
  const got = await r.get("in-1");
  assert.deepEqual([got.from, got.size, got.keptUntil.getUTCDate(), got.content?.subject, got.content?.partial, got.content?.cc, got.content?.html], ["ana@example.org", 512, 8, "Hi", true, [], undefined]);
  assert.deepEqual(got.content?.headers.map((h) => h.value), ["x", "y"]);
  assert.equal(got.content?.attachments[0]?.filename, "a.pdf");
  const listed: (string | undefined)[] = [];
  for await (const item of r.all()) listed.push(item.from, String(item.content));
  assert.deepEqual(listed, ["ana@example.org", "undefined", undefined, "undefined"]);
  assert.deepEqual(Buffer.from(await r.raw("in-1")), raw);
  assert.deepEqual(Buffer.from(await r.file("in-1", 1)), raw);
  await r.delete("in-1");
  assert.deepEqual(s.seen.map((x) => `${x.method} ${x.path}${x.query && "?" + x.query}`), ["GET /inbound/in-1", "GET /inbound?limit=200", "GET /inbound/in-1/raw", "GET /inbound/in-1/attachments/1", "DELETE /inbound/in-1"]);
});

test("limits, health and captured", async (t) => {
  const s = await serving(t, (res, n, seen) => {
    if (seen.path === "/limits") return void res.end(n === 1 ? `{"driver":"cloudflare","quota":{"limit":200,"per":"day","used":7,"over":false,"resets_at":"2030-01-02T00:00:00Z"}}` : `{"driver":"capture","quota":null}`);
    if (seen.path === "/health") return void res.writeHead(503).end(`{"status":"unavailable","driver":"capture","version":"0.1.1","events":"off","webhooks":"sending","pruning":"running","scheduled":"sending","inbound":"off"}`);
    res.end(`{"data":[{"id":"c1","at":"2030-01-01T00:00:00Z","from":"a@example.com","to":["b@example.org"],"subject":"s","text":"t","attachments":[{"filename":"a.txt","content_type":"text/plain","size":2}]}]}`);
  });
  const l = await s.client.limits();
  assert.deepEqual(l, { driver: "cloudflare", quota: { limit: 200, per: "day", used: 7, over: false, resetsAt: new Date("2030-01-02T00:00:00Z") } });
  assert.deepEqual(await s.client.limits(), { driver: "capture" });
  // A server that is up and cannot reach its database is answered, not an error.
  const h = await s.client.health();
  assert.deepEqual([h.ok, h.status, h.version, h.webhooks, h.inbound], [false, "unavailable", "0.1.1", "sending", "off"]);
  const held = await s.client.captured();
  assert.deepEqual([held[0]?.subject, held[0]?.to, held[0]?.cc, held[0]?.attachments[0]?.size], ["s", ["b@example.org"], [], 2]);
});

test("health says a wrong address, and captured a server that delivers for real", async (t) => {
  for (const [status, body] of [[404, `{"name":"route_not_found","message":"Nothing here."}`], [404, "<html>"], [200, `{"ok":true}`], [503, "<html>down</html>"], [503, `{"name":"unavailable","message":"Down."}`]] as const) {
    const s = await serve(t, status, body);
    const err = await thrown(() => s.client.health());
    assert.ok(err instanceof CairnPostError || err instanceof TransportError, body);
    assert.equal(isWrongAddress(err), status === 404, body);
  }
  const real = await serving(t, (res, _n, seen) => (seen.path === "/health" ? res.end(up.replace("capture", "cloudflare")) : res.writeHead(404).end(`{"name":"route_not_found","message":"Nothing here."}`)));
  assert.ok((await thrown(() => real.client.captured())) instanceof NotCapturingError);
  // With no server of CairnPost's there at all, the address is what is wrong.
  const none = await serve(t, 404, `{"name":"route_not_found","message":"Nothing here."}`);
  assert.ok(isWrongAddress(await thrown(() => none.client.captured())));
  // Health failing some other way is its own error, not a wrong address.
  const stop = new AbortController();
  const slow = await serving(t, (res, _n, seen) => (seen.path === "/health" ? stop.abort() : res.writeHead(404).end(`{"name":"route_not_found","message":"Nothing here."}`)));
  const cut = await thrown(() => slow.client.captured({ signal: stop.signal }));
  assert.ok(cut instanceof TransportError && cut.reason === "cancelled");
});

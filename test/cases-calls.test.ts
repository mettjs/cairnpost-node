import assert from "node:assert/strict";
import { test } from "node:test";
import { ask, asking } from "./asking.ts";
import { cases, instants, listed, only, saying, type Said } from "./cases.ts";
import { key, serve } from "./stand.ts";

interface SharedCall {
  name: string;
  route: string;
  key: string;
  sends: { method: string; path: string; query?: Record<string, string>; idempotency_key?: string; body?: unknown };
  answer: Said;
}

// The table is held to every call there is, so that a new call is put in
// front of the shared cases, or this fails.
test("every call is in the table", async (t) => {
  const c = (await serve(t, 200, "{}")).client;
  // These read no answer of their own: they walk a call that is there.
  const walks = ["suppressions.all", "webhooks.allDeliveries", "received.all"];
  // The client, and each part of it: whatever it holds that is an object.
  const parts: [string, object][] = [["", c]];
  for (const [name, part] of Object.entries(c)) {
    if (typeof part === "object" && part !== null) parts.push([name + ".", part as object]);
  }
  assert.deepEqual(parts.map(([prefix]) => prefix).sort(), ["", "emails.", "received.", "suppressions.", "templates.", "webhooks."]);
  const there = parts.flatMap(([prefix, part]) =>
    Object.getOwnPropertyNames(Object.getPrototypeOf(part)).filter((method) => method !== "constructor").map((method) => prefix + method),
  );
  assert.deepEqual([...asking.map(([, method]) => method), ...walks].sort(), there.sort());
});

// Each call sends what every client sends for it, and takes the answer
// the server gives.
test("each call sends what it should and takes the server's answer", async (t) => {
  const described = listed<SharedCall>(cases("calls.json"), "calls");
  for (const c of described) {
    only(c.name, c, ["name", "route", "key", "sends", "answer"]);
    only(`what ${c.name} sends`, c.sends, ["method", "path", "query", "idempotency_key", "body"]);
    const s = await saying(t, c.answer);
    await ask(c.name)(s.client);
    assert.equal(s.seen.length, 1, `${c.name} made ${s.seen.length} requests`);
    const [got] = s.seen;
    assert.ok(got !== undefined);
    const query = new URLSearchParams(got.query);
    assert.equal(new Set(query.keys()).size, [...query.keys()].length, `${c.name} says a thing twice in ${got.query}`);
    assert.deepEqual(
      { method: got.method, path: got.path, query: Object.fromEntries(query), key: got.auth, idempotency_key: got.idem },
      {
        method: c.sends.method,
        path: c.sends.path,
        query: c.sends.query ?? {},
        key: c.key === "none" ? "" : `Bearer ${key}`,
        idempotency_key: c.sends.idempotency_key ?? "",
      },
      `what ${c.name} sent`,
    );
    if (c.sends.body === undefined) {
      assert.deepEqual([got.body, got.contentType], ["", ""], `${c.name} sent a body where none is sent`);
    } else {
      assert.equal(got.contentType, "application/json", c.name);
      assert.deepEqual(instants(JSON.parse(got.body)), instants(c.sends.body), `the body ${c.name} sent`);
    }
  }
  assert.deepEqual(asking.map(([name]) => name).sort(), described.map((c) => c.name).sort(), "the calls of this client, and those calls.json describes");
});

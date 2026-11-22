import assert from "node:assert/strict";
import { test } from "node:test";
import { TransportError } from "../src/index.ts";
import { serve, thrown } from "./stand.ts";

// The answers every client must take or refuse are the shared cases
// (cases-answers.test.ts). What follows is this client's own: a batch of
// no email, and what a call reads out of an answer that says "none".

// A batch says its list also when no email was asked.
test("a batch of none is held to its answer too", async (t) => {
  for (const body of ["{}", `{"data":null}`]) {
    const err = await thrown(async () => (await serve(t, 200, body)).client.emails.sendBatch({ emails: [] }));
    assert.ok(err instanceof TransportError && err.reason === "not_cairnpost", `a batch of none took ${body}`);
  }
  assert.deepEqual(await (await serve(t, 200, `{"data":[]}`)).client.emails.sendBatch({ emails: [] }), []);
});

// What CairnPost says of nothing is still read as nothing.
test("an empty list and a no are still read", async (t) => {
  const c = (await serve(t, 200, `{"data":[],"added":false,"lifted":0,"delivered":false,"more":false}`)).client;
  assert.deepEqual(await c.suppressions.list(), { data: [] });
  assert.deepEqual(await c.webhooks.list(), []);
  assert.deepEqual(await c.templates.list(), { data: [], more: false });
  assert.deepEqual(await c.captured(), []);
  assert.equal(await c.suppressions.add("example.com", "a@example.org"), false);
  assert.equal(await c.suppressions.liftAll("example.com"), 0);
  assert.deepEqual(await c.webhooks.test("w"), { delivered: false });
});

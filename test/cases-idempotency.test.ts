import assert from "node:assert/strict";
import { test } from "node:test";
import { inspect } from "node:util";
import type { CairnPost } from "../src/index.ts";
import { cases, listed, only, saying, type Said } from "./cases.ts";
import { thrown } from "./stand.ts";

const email = { from: "app@example.com", to: ["ana@example.org"], subject: "Welcome", text: "Hello." };

// The two calls that take a key, under the names the cases know them by.
const sends: Record<string, (c: CairnPost, key: string, emails: number) => Promise<unknown>> = {
  "emails.send": (c, key) => c.emails.send({ ...email, idempotencyKey: key }),
  "emails.send_batch": (c, key, emails) => c.emails.sendBatch({ emails: Array.from({ length: emails }, () => email), idempotencyKey: key }),
};

// An idempotency key goes out as it was given, or the send is not made:
// a key a header cannot carry as it is would be changed on the way, and
// the send would quietly not be idempotent. So for a send and for a
// batch alike, and the refusal does not repeat the key.
test("an idempotency key is sent as it is or not at all", async (t) => {
  const file = cases("idempotency.json");
  only("idempotency.json", file, ["taken", "refused"]);
  const described = listed<{ name: string; answer: Said }>(cases("calls.json"), "calls");
  for (const [name, send] of Object.entries(sends)) {
    const call = described.find((c) => c.name === name);
    assert.ok(call !== undefined, `the cases describe no call named ${name}`);
    // As many emails as the batch's answer in the cases tells of.
    const data = (call.answer.json as { data?: unknown[] }).data;
    const emails = Array.isArray(data) ? data.length : 1;
    for (const key of listed<string>(file, "taken")) {
      const s = await saying(t, call.answer);
      await send(s.client, key, emails);
      assert.equal(s.seen.length, 1, `${name} with the key ${JSON.stringify(key)} made ${s.seen.length} requests`);
      assert.equal(s.seen[0]?.idem, key, `what ${name} sent the key ${JSON.stringify(key)} as`);
    }
    const s = await saying(t, call.answer);
    for (const key of listed<string>(file, "refused")) {
      const err = await thrown(() => send(s.client, key, emails));
      assert.ok(err instanceof TypeError, `${name} with the key ${JSON.stringify(key)}: ${String(err)}`);
      assert.equal(s.seen.length, 0, `${name} with the key ${JSON.stringify(key)} made a request`);
      const shown = err.message + inspect(err);
      for (let i = 0; i + 6 <= key.length; i++) {
        assert.ok(!shown.includes(key.slice(i, i + 6)), `the refusal of the key ${JSON.stringify(key)} repeats part of it`);
      }
    }
  }
});

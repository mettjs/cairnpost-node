import assert from "node:assert/strict";
import { test } from "node:test";
import { inspect } from "node:util";
import { CairnPost } from "../src/index.ts";
import { ask } from "./asking.ts";
import { cases, listed, only, saying, type Said } from "./cases.ts";

// A key is taken when it could be one: what a server gives, with at most
// a space, a tab or a line break around it, and it is sent without them.
// Any other is refused when the client is made, before a call, by an
// error that does not repeat it.
test("a key is taken only when it could be one", async (t) => {
  const file = cases("keys.json");
  only("keys.json", file, ["taken", "refused"]);
  // Any call that needs a key shows what is sent for one.
  const call = listed<{ name: string; key: string; answer: Said }>(cases("calls.json"), "calls").find((c) => c.key !== "none");
  assert.ok(call !== undefined, "no call needs a key");
  for (const k of listed<{ given: string; sends: string }>(file, "taken")) {
    only("a key to take", k, ["given", "sends"]);
    const s = await saying(t, call.answer);
    let client: CairnPost | undefined;
    try {
      client = new CairnPost(s.url, k.given);
    } catch {
      // Said below, without the error.
    }
    assert.ok(client !== undefined, `${JSON.stringify(k.given)} was refused as a key`);
    await ask(call.name)(client);
    assert.equal(s.seen.length, 1, `${call.name} made ${s.seen.length} requests`);
    assert.equal(s.seen[0]?.auth, "Bearer " + k.sends, `what ${JSON.stringify(k.given)} was sent as`);
  }
  for (const key of listed<string>(file, "refused")) {
    let err: unknown;
    try {
      new CairnPost("https://mail.example.com", key);
    } catch (thrown) {
      err = thrown;
    }
    assert.ok(err instanceof TypeError, `${JSON.stringify(key)} was taken as a key`);
    const shown = err.message + inspect(err);
    for (let i = 0; i + 8 <= key.length; i++) {
      assert.ok(!shown.includes(key.slice(i, i + 8)), `the refusal of ${JSON.stringify(key)} repeats part of it`);
    }
  }
});

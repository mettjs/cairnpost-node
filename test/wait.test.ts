import assert from "node:assert/strict";
import { test } from "node:test";
import { CairnPostError } from "../src/index.ts";
import { waitOf } from "../src/wait.ts";
import { serving, thrown } from "./stand.ts";

// A header said more than once is handed over as one value with a comma
// between: so two waits are none, and a date cut in two at its comma is
// that date. The Go client reads it the same.
test("a Retry-After said twice is read as one value", async (t) => {
  const date = new Date(Date.now() + 90_000).toUTCString();
  const said = [["7", "9"], ["7", "7"], ["soon", "9"], [date.slice(0, 3), date.slice(5)]];
  const s = await serving(t, (res, n) => {
    res.setHeader("retry-after", said[n - 1] ?? []);
    res.writeHead(503).end();
  });
  for (const [i, values] of said.entries()) {
    const err = await thrown(() => s.client.emails.get("x"));
    assert.ok(err instanceof CairnPostError && err.status === 503, String(err));
    const wait = err.retryAfterMs;
    if (i < said.length - 1) assert.equal(wait, undefined, JSON.stringify(values));
    else assert.ok(wait !== undefined && wait > 80_000 && wait <= 91_000, `${JSON.stringify(values)}: ${wait}`);
  }
});

test("no header at all is no wait", () => {
  assert.equal(waitOf(null), undefined);
  assert.equal(waitOf(""), undefined);
});

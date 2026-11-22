import assert from "node:assert/strict";
import { test } from "node:test";
import { CairnPostError, mayHaveSent } from "../src/index.ts";
import { waitOf } from "../src/wait.ts";
import { cases, listed, only } from "./cases.ts";
import { serving, thrown } from "./stand.ts";

const email = { from: "app@example.com", to: ["ana@example.org"], subject: "Welcome", text: "Hello." };

interface Wait {
  now?: number;
  given: string;
  seconds: number | null;
}

const wanted = (k: Wait) => (k.seconds === null ? undefined : k.seconds * 1000);

// A caller sleeps for the wait an error says, so every client reads the
// same wait in the same answer: in the Retry-After header of a refusal,
// in what a batch's answer says of one email, and in a value read at a
// time that is said.
test("a wait is read as every client reads it", async (t) => {
  const file = cases("waits.json");
  only("waits.json", file, ["header", "batch", "read"]);
  const header = listed<Wait>(file, "header");
  const batch = listed<Wait>(file, "batch");
  const read = listed<Wait>(file, "read");
  assert.ok(header.length > 0 && batch.length > 0 && read.length > 0, "waits.json holds no header to read, no batch, or no value read at a said time");
  for (const k of [...header, ...batch]) only(`the case of ${JSON.stringify(k.given)}`, k, ["given", "seconds"]);
  for (const k of read) {
    only(`the case of ${JSON.stringify(k.given)}`, k, ["now", "given", "seconds"]);
    assert.ok(typeof k.now === "number", `the case of ${JSON.stringify(k.given)} says no time`);
    assert.equal(waitOf(k.given, k.now), wanted(k), `the wait read in ${JSON.stringify(k.given)} at ${k.now}`);
  }

  const refusing = await serving(t, (res, n) => {
    res.writeHead(503, { "content-type": "application/json", "retry-after": header[n - 1]?.given ?? "" });
    res.end(`{"statusCode":503,"name":"unavailable","message":"Down."}`);
  });
  for (const k of header) {
    const err = await thrown(() => refusing.client.emails.send(email));
    assert.ok(err instanceof CairnPostError && err.code === "unavailable", `Retry-After ${JSON.stringify(k.given)}: the refusal was not read: ${String(err)}`);
    assert.equal(err.retryAfterMs, wanted(k), `the wait read in a Retry-After of ${JSON.stringify(k.given)}`);
  }

  const answering = await serving(t, (res, n) => {
    res.writeHead(207, { "content-type": "application/json" });
    // As it is written in the cases, not read and written again.
    res.end(`{"data":[{"error":{"statusCode":429,"name":"rate_limit_exceeded","message":"Later.","retry_after":${batch[n - 1]?.given ?? "null"}}}]}`);
  });
  for (const k of batch) {
    const results = await answering.client.emails.sendBatch({ emails: [email] });
    const err = results[0]?.error;
    assert.ok(results.length === 1 && err?.code === "rate_limit_exceeded" && !mayHaveSent(err), `retry_after ${k.given}: the email's error was not read`);
    assert.equal(err.retryAfterMs, wanted(k), `the wait read in a retry_after of ${k.given}`);
  }
});

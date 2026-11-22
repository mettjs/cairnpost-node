import assert from "node:assert/strict";
import { test } from "node:test";
import { inspect } from "node:util";
import { CairnPostError, isNotFound, isWrongAddress, mayHaveSent } from "../src/index.ts";
import { ask } from "./asking.ts";
import { cases, listed, only, saying, type Said } from "./cases.ts";
import { thrown } from "./stand.ts";

interface Want {
  status: number;
  code: string | null;
  detail: string | null;
  email_id: string | null;
  retry_after: number | null;
  retryable: boolean;
  may_have_sent: boolean;
  not_found: boolean;
  wrong_address: boolean;
}

// An error says what to do: whether to try again, whether the email may
// have gone, whether a record is missing or the address is wrong. Only
// under a name of CairnPost's is anything but the status believed: what
// any other answer says is not repeated.
test("an error says what to do", async (t) => {
  const file = cases("errors.json");
  only("errors.json", file, ["cases"]);
  for (const c of listed<{ name: string; call: string; answer: Said; want: Want }>(file, "cases")) {
    only(c.name, c, ["name", "call", "answer", "want"]);
    const s = await saying(t, c.answer);
    const err = await thrown(() => ask(c.call)(s.client));
    assert.ok(err instanceof CairnPostError, `${c.name}: ${String(err)}`);
    const got: Want = {
      status: err.status,
      code: err.code ?? null,
      detail: err.detail ?? null,
      email_id: err.emailId ?? null,
      retry_after: err.retryAfterMs === undefined ? null : err.retryAfterMs / 1000,
      retryable: err.retryable,
      may_have_sent: mayHaveSent(err),
      not_found: isNotFound(err),
      wrong_address: isWrongAddress(err),
    };
    assert.deepEqual(got, c.want, c.name);
    const message = (c.answer.json as { message?: unknown } | null)?.message;
    if (c.want.code === null && typeof message === "string" && message !== "") {
      const all = inspect(err, { depth: 9, showHidden: true }) + String(err.stack);
      assert.ok(!all.includes(message), `${c.name}: the error repeats what was answered`);
    }
  }
});

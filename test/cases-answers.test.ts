import assert from "node:assert/strict";
import { test } from "node:test";
import { TransportError } from "../src/index.ts";
import { ask, callsOf } from "./asking.ts";
import { cases, listed, only, saying, type Said } from "./cases.ts";
import { thrown } from "./stand.ts";

interface AnswerCase {
  name: string;
  calls: unknown;
  answer: Said;
}

// Something else at the address, or between, can answer 200 to anything,
// and an answer can be of CairnPost's kind and still not be the answer to
// what was asked. None of it may read as "done", "no" or "none"; and what
// CairnPost does say is taken.
test("an answer is taken only when it is CairnPost's", async (t) => {
  const file = cases("answers.json");
  only("answers.json", file, ["refused", "taken"]);
  const wrong: string[] = [];
  for (const c of listed<AnswerCase>(file, "refused")) {
    only(c.name, c, ["name", "calls", "answer"]);
    const s = await saying(t, c.answer);
    for (const name of callsOf(c.name, c.calls)) {
      const err = await thrown(() => ask(name)(s.client)).catch((none: unknown) => none);
      if (!(err instanceof TransportError && err.reason === "not_cairnpost")) wrong.push(`${name} took ${c.name}: ${String(err)}`);
    }
  }
  for (const c of listed<AnswerCase>(file, "taken")) {
    only(c.name, c, ["name", "calls", "answer"]);
    const s = await saying(t, c.answer);
    for (const name of callsOf(c.name, c.calls)) {
      await ask(name)(s.client).catch((err: unknown) => wrong.push(`${name} refused ${c.name}: ${String(err)}`));
    }
  }
  assert.deepEqual(wrong, []);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { Verifier, WebhookError, type WebhookEvent } from "../src/index.ts";
import { cases, listed, only } from "./cases.ts";

interface WebhookCase {
  name: string;
  headers: Record<string, string>;
  body: string;
  tolerance?: number;
  want: { refused?: string; event?: unknown };
}

const stamp = (at: Date | undefined) => (at === undefined ? "" : at.toISOString().replace(".000Z", "Z"));

/**
 * A verified event in the form the shared cases write one: every field
 * said, a time as its instant in UTC, "" for what is not there.
 */
function plain(e: WebhookEvent): Record<string, unknown> {
  const out: Record<string, unknown> = { id: e.id, type: e.type, at: stamp(e.at) };
  if (e.email !== undefined) {
    const m = e.email;
    out["email"] = {
      id: m.id,
      from: m.from,
      to: m.to,
      created_at: stamp(m.createdAt),
      code: m.code ?? "",
      reason: m.reason ?? "",
      bounce: m.bounce?.type ?? "",
      suppressed: m.suppressed,
    };
  }
  if (e.suppression !== undefined) out["suppression"] = { ...e.suppression };
  if (e.received !== undefined) {
    out["received"] = { id: e.received.id, from: e.received.from, to: e.received.to, received_at: stamp(e.received.receivedAt) };
  }
  return out;
}

/** Why a webhook, or a secret, was refused; "taken" when it was not. */
function refusal(run: () => unknown): string {
  try {
    run();
  } catch (err) {
    assert.ok(err instanceof WebhookError, String(err));
    return err.reason;
  }
  return "taken";
}

// A webhook is read when the endpoint's secret signed it and it says
// what it is about, and refused otherwise, each for its own reason.
test("a webhook is read only when it is the endpoint's", () => {
  const file = cases("webhooks.json") as { secret: string; now: number; secrets: { taken: string[]; refused: string[] } };
  only("webhooks.json", file, ["secret", "now", "secrets", "cases"]);
  only("the secrets", file.secrets, ["taken", "refused"]);
  assert.ok(file.secrets.taken.length > 0 && file.secrets.refused.length > 0, "the file holds no secret to take, or none to refuse");
  for (const secret of file.secrets.taken) assert.equal(refusal(() => new Verifier(secret)), "taken", JSON.stringify(secret));
  for (const secret of file.secrets.refused) assert.equal(refusal(() => new Verifier(secret)), "secret", JSON.stringify(secret));
  for (const c of listed<WebhookCase>(file, "cases")) {
    only(c.name, c, ["name", "headers", "body", "tolerance", "want"]);
    only(`what ${c.name} wants`, c.want, ["refused", "event"]);
    assert.notEqual("refused" in c.want, "event" in c.want, `${c.name} wants an event or a refusal, and not both`);
    const v = new Verifier(file.secret, { now: () => file.now * 1000, toleranceMs: c.tolerance === undefined ? undefined : c.tolerance * 1000 });
    let read: WebhookEvent | undefined;
    const why = refusal(() => (read = v.verify(c.headers, c.body)));
    if ("refused" in c.want) {
      assert.ok(["unsigned", "signature", "stale", "payload"].includes(c.want.refused ?? ""), `${c.name}: ${c.want.refused} is no refusal`);
      assert.equal(why, c.want.refused, c.name);
    } else {
      assert.equal(why, "taken", c.name);
      assert.deepEqual(plain(read as unknown as WebhookEvent), c.want.event, c.name);
    }
  }
});

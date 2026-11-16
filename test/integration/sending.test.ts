import assert from "node:assert/strict";
import { test } from "node:test";
import { inspect } from "node:util";
import { CairnPost, CairnPostError, ErrorCode, failed, isNotFound, mayHaveSent, State } from "../../src/index.ts";
import { admin, code, run, send, url } from "./live.ts";

const from = `App <app@${run}.example.com>`;

test("sending against a real server", async () => {
  const h = await send.health();
  assert.deepEqual([h.ok, h.driver], [true, "capture"], "the server must be up and on the capture driver");
  assert.deepEqual(await send.limits(), { driver: "capture" });
  const email = { from, to: ["ana@example.org"], subject: `Hello ${run}`, text: "Body", html: "<p>Body & more</p>", replyTo: "help@example.com", headers: { "X-Run": run }, idempotencyKey: run };
  const first = await send.emails.send(email);
  // The same request again is the same email; another under its key is refused.
  assert.equal((await send.emails.send(email)).id, first.id);
  assert.equal(await code(() => send.emails.send({ ...email, subject: "Another" })), ErrorCode.idempotentMismatch);
  const m = await send.emails.get(first.id);
  assert.deepEqual([m.id, m.state, m.to, m.recipients.length, m.events], [first.id, State.sent, "ana@example.org", 1, []]);
  assert.ok(Math.abs(m.createdAt.getTime() - Date.now()) < 60_000, "the time it was made is now");
  // A send key is not shown what an email said; an admin key is.
  assert.equal(m.content, undefined);
  const whole = await admin.emails.get(first.id);
  assert.deepEqual([whole.content?.subject, whole.content?.fromName, whole.content?.html, whole.content?.headers?.["X-Run"]], [email.subject, "App", email.html, run]);
  assert.ok(whole.content && whole.content.keptUntil > new Date());

  const held = await admin.captured();
  assert.ok(held.some((c) => c.subject === email.subject && c.fromName === "App" && c.html === email.html && c.headers?.["X-Run"] === run && c.replyTo === "help@example.com"), "the email is among the captured");
  assert.equal(await code(() => send.captured()), ErrorCode.adminKeyRequired);
  assert.equal(await code(() => new CairnPost(url, "cp_00000000_not-a-key").emails.get(first.id)), ErrorCode.invalidKey);
  assert.ok(isNotFound(await send.emails.get("0199-none").catch((err: unknown) => err)));
});

test("several addresses, a batch and an email asked for later", async () => {
  const several = await send.emails.send({ from, to: ["ana@example.org", "ben@example.org"], cc: ["cy@example.org"], bcc: ["dee@example.org"], subject: `Several ${run}`, text: "Body" });
  const m = await send.emails.get(several.id);
  assert.deepEqual(m.recipients.map((r) => `${r.kind}:${r.address}:${r.state}`), ["to:ana@example.org:sent", "to:ben@example.org:sent", "cc:cy@example.org:sent", "bcc:dee@example.org:sent"]);
  // A batch: each email has its own id, and the batch again is the same.
  const batch = { idempotencyKey: `${run}-batch`, emails: [
    { from, to: ["ben@example.org"], subject: `One ${run}`, text: "Body" },
    { from, to: ["cy@example.org"], subject: `Two ${run}`, text: "Body" },
  ] };
  const sent = await send.emails.sendBatch(batch);
  assert.deepEqual([sent.length, failed(sent)], [2, 0]);
  assert.notEqual(sent[0]?.sent?.id, sent[1]?.sent?.id);
  const again = await send.emails.sendBatch(batch);
  assert.deepEqual(again.map((r) => r.sent?.id), sent.map((r) => r.sent?.id));
  const broken = await send.emails.sendBatch({ ...batch, emails: [batch.emails[0]!, { ...batch.emails[1]!, to: [] }] }).catch((err: unknown) => err);
  assert.ok(broken instanceof CairnPostError && broken.code === ErrorCode.validation && !mayHaveSent(broken), "a batch with an email that cannot go");
  // An email asked for later waits, is moved and is cancelled.
  const at = new Date(Date.now() + 3_600_000);
  const waits = await send.emails.send({ from, to: ["dee@example.org"], subject: `Later ${run}`, text: "Body", scheduledAt: at });
  assert.ok(waits.scheduledAt && Math.abs(waits.scheduledAt.getTime() - at.getTime()) < 1000);
  const waiting = await send.emails.get(waits.id);
  assert.deepEqual([waiting.state, waiting.scheduledAt !== undefined], [State.scheduled, true]);
  await send.emails.reschedule(waits.id, new Date(Date.now() + 7_200_000));
  await send.emails.cancel(waits.id);
  assert.equal(await code(() => send.emails.cancel(waits.id)), ErrorCode.notScheduled);
  assert.equal((await send.emails.get(waits.id)).state, State.cancelled);
  assert.equal(await code(() => send.emails.send({ from, to: ["dee@example.org"], subject: "s", text: "t", scheduledAt: new Date(Date.now() - 3_600_000) })), ErrorCode.validation);
});

test("files, templates and suppressions", async () => {
  const bytes = Buffer.from([0, 1, 2, 255, 254, 10, 13]);
  const filed = await send.emails.send({ from, to: ["ana@example.org"], subject: `Filed ${run}`, html: `<img src="cid:dot">`, attachments: [{ filename: "data.bin", content: bytes }, { filename: "dot.png", content: Buffer.from("png"), contentId: "dot" }] });
  const files = (await admin.emails.get(filed.id)).content?.attachments ?? [];
  assert.deepEqual(files.map((f) => [f.filename, f.contentType, f.contentId, f.size, f.kept]), [["data.bin", "application/octet-stream", undefined, 7, true], ["dot.png", "image/png", "dot", 3, true]]);
  assert.deepEqual(Buffer.from(await admin.emails.file(filed.id, 1)), bytes);
  assert.equal(await code(() => send.emails.file(filed.id, 1)), ErrorCode.adminKeyRequired);
  assert.ok(isNotFound(await admin.emails.file(filed.id, 3).catch((err: unknown) => err)));

  const name = `welcome-${run}`;
  const made = await admin.templates.create({ name, subject: "Code for {{name}} " + run, html: "<b>{{code}}</b>", text: "{{code}}", defaults: { name: "you" } });
  assert.deepEqual(made.variables.map((v) => [v.name, v.default, v.required]).sort(), [["code", undefined, true], ["name", "you", false]]);
  assert.equal(await code(() => admin.templates.create({ name, subject: "s", text: "t" })), ErrorCode.nameTaken);
  await send.emails.send({ from, to: ["ana@example.org"], template: { name, variables: { code: "<1>" } } });
  const filled = (await admin.captured()).find((c) => c.subject === `Code for you ${run}`);
  assert.deepEqual([filled?.html, filled?.text], ["<b>&lt;1&gt;</b>", "<1>"]);
  assert.equal(await code(() => send.emails.send({ from, to: ["ana@example.org"], template: { name } })), ErrorCode.validation);
  const changed = await admin.templates.update(made.id, { subject: "Changed " + run, defaults: {} });
  assert.deepEqual([changed.subject, changed.html, changed.variables.every((v) => v.required)], ["Changed " + run, "<b>{{code}}</b>", true]);
  assert.ok((await admin.templates.list()).data.some((t) => t.id === made.id && t.html === undefined));
  await admin.templates.delete(made.id);
  assert.ok(isNotFound(await admin.templates.get(made.id).catch((err: unknown) => err)));

  const domain = `${run}.example.com`;
  assert.equal(await admin.suppressions.add(domain, "Gone@Example.org", "asked"), true);
  assert.equal(await admin.suppressions.add(domain, "gone@example.org"), false);
  await admin.suppressions.add(domain, "also@example.org");
  const listed: string[] = [];
  for await (const s of admin.suppressions.all(domain)) listed.push(`${s.address}:${s.reason}:${s.note ?? ""}`);
  assert.deepEqual(listed, ["also@example.org:manual:", "gone@example.org:manual:asked"]);
  const page = await admin.suppressions.list({ domain, limit: 1 });
  assert.deepEqual([page.data.length, typeof page.next], [1, "string"]);
  // An email to a suppressed address and another goes to the other, and says so.
  const part = await send.emails.send({ from, to: ["gone@example.org", "ana@example.org"], subject: `Part ${run}`, text: "Body" });
  assert.deepEqual(part.suppressed, ["gone@example.org"]);
  assert.deepEqual((await send.emails.get(part.id)).suppressed, ["gone@example.org"]);
  const none = await send.emails.send({ from, to: ["gone@example.org"], subject: "SUBJECTMARKQ", text: "TEXTMARKQ" }).catch((err: unknown) => err);
  assert.ok(none instanceof CairnPostError && none.code === ErrorCode.recipientSuppressed && !none.retryable && !mayHaveSent(none));
  assert.ok(!/SUBJECTMARKQ|TEXTMARKQ/.test(inspect(none, { depth: 9 })));
  await admin.suppressions.lift(domain, "gone@example.org");
  assert.ok(isNotFound(await admin.suppressions.lift(domain, "gone@example.org").catch((err: unknown) => err)));
  assert.equal(await admin.suppressions.liftAll(domain), 1);
});

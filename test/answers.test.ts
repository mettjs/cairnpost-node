import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { type CairnPost, TransportError } from "../src/index.ts";
import { serve, thrown, up } from "./stand.ts";

const to = { from: "app@example.com", to: ["ana@example.org"], text: "t" };

// Every call that reads an answer, each to be made against a server that
// says something CairnPost never does.
const answering: Record<string, (c: CairnPost) => Promise<unknown>> = {
  "emails.send": (c) => c.emails.send(to),
  "emails.sendBatch": (c) => c.emails.sendBatch({ emails: [to] }),
  "emails.get": (c) => c.emails.get("m"),
  "emails.cancel": (c) => c.emails.cancel("m"),
  "emails.reschedule": (c) => c.emails.reschedule("m", new Date(1_900_000_000_000)),
  "emails.file": (c) => c.emails.file("m", 1),
  limits: (c) => c.limits(),
  health: (c) => c.health(),
  captured: (c) => c.captured(),
  "suppressions.list": (c) => c.suppressions.list(),
  "suppressions.add": (c) => c.suppressions.add("example.com", "a@example.org"),
  "suppressions.lift": (c) => c.suppressions.lift("example.com", "a@example.org"),
  "suppressions.liftAll": (c) => c.suppressions.liftAll("example.com"),
  "webhooks.create": (c) => c.webhooks.create({ url: "https://app.example.com/hook" }),
  "webhooks.list": (c) => c.webhooks.list(),
  "webhooks.get": (c) => c.webhooks.get("w"),
  "webhooks.update": (c) => c.webhooks.update("w", {}),
  "webhooks.delete": (c) => c.webhooks.delete("w"),
  "webhooks.rotateSecret": (c) => c.webhooks.rotateSecret("w"),
  "webhooks.resume": (c) => c.webhooks.resume("w"),
  "webhooks.test": (c) => c.webhooks.test("w"),
  "webhooks.deliveries": (c) => c.webhooks.deliveries("w"),
  "webhooks.retryDelivery": (c) => c.webhooks.retryDelivery("w", "d"),
  "templates.create": (c) => c.templates.create({ name: "n", subject: "s" }),
  "templates.list": (c) => c.templates.list(),
  "templates.get": (c) => c.templates.get("t"),
  "templates.update": (c) => c.templates.update("t", {}),
  "templates.delete": (c) => c.templates.delete("t"),
  "received.list": (c) => c.received.list(),
  "received.get": (c) => c.received.get("r"),
  "received.raw": (c) => c.received.raw("r"),
  "received.file": (c) => c.received.file("r", 1),
  "received.delete": (c) => c.received.delete("r"),
};

/** Makes a call, and says whether its answer was refused as not CairnPost's. */
async function refuses(c: CairnPost, name: string): Promise<boolean> {
  const ask = answering[name];
  if (ask === undefined) throw new Error(`${name} is not in the table of calls`);
  const err = await thrown(() => ask(c)).catch((none: unknown) => none);
  return err instanceof TransportError && err.reason === "not_cairnpost";
}

/** Makes a call against a server that answers `body`, and says whether it was refused. */
async function refused(t: TestContext, name: string, status: number, body: string): Promise<boolean> {
  return refuses((await serve(t, status, body)).client, name);
}

// Something else at the address, or between, can answer 200 to anything.
// None of it may read as "done", "no" or "none".
test("no call takes an answer that is not CairnPost's", async (t) => {
  const bodies: Record<string, string> = {
    "an empty object": "{}",
    null: "null",
    "a page": "<html>maintenance</html>",
    nothing: "",
    "every field null":
      `{"id":null,"state":null,"data":null,"added":null,"lifted":null,"delivered":null,"driver":null,` +
      `"status":null,"created_at":null,"updated_at":null,"received_at":null,"kept_until":null}`,
  };
  for (const [what, body] of Object.entries(bodies)) {
    const c = (await serve(t, 200, body)).client;
    for (const name of Object.keys(answering)) {
      assert.ok(await refuses(c, name), `${name} answered ${what}`);
    }
  }
});

// A record says when it was made: one that does not was not written by
// CairnPost, alone or in a list.
test("a record without its times is refused", async (t) => {
  const body = `{"id":"x","more":false,"data":[{"id":"x"}]}`;
  const records = [
    "emails.get", "captured", "suppressions.list", "webhooks.create", "webhooks.list", "webhooks.get", "webhooks.update",
    "webhooks.rotateSecret", "webhooks.resume", "webhooks.deliveries", "templates.create", "templates.list", "templates.get",
    "templates.update", "received.list", "received.get",
  ];
  const c = (await serve(t, 200, body)).client;
  for (const name of records) assert.ok(await refuses(c, name), name);
});

// An answer can be a whole object of CairnPost's kind and still not be
// the answer to what was asked.
test("an answer about something else is refused", async (t) => {
  const at = `"created_at":"2030-01-01T00:00:00Z","updated_at":"2030-01-01T00:00:00Z","received_at":"2030-01-01T00:00:00Z","kept_until":"2030-01-01T00:00:00Z"`;
  const answers: Record<string, string> = {
    "emails.cancel": `{"id":"req-123","state":"cancelled"}`,
    "emails.reschedule": `{"id":"req-123","scheduled_at":"2030-01-31T08:00:00Z"}`,
    "suppressions.lift": `{"lifted":0}`,
    "suppressions.liftAll": `{"lifted":-1}`,
    "webhooks.retryDelivery": `{"state":"error"}`,
    "webhooks.create": `{"id":"w1",${at}}`,
    "webhooks.rotateSecret": `{"id":"w1",${at}}`,
    limits: `{"driver":""}`,
    "webhooks.list": `{"data":[{${at}}]}`,
    "templates.list": `{"more":false,"data":[{${at}}]}`,
    "received.list": `{"data":[{${at}}]}`,
    "webhooks.deliveries": `{"data":[{${at}}]}`,
    "suppressions.list": `{"data":[{${at}}]}`,
    captured: `{"data":[{"at":"2030-01-01T00:00:00Z"}]}`,
  };
  const took: string[] = [];
  for (const [name, body] of Object.entries(answers)) {
    if (!(await refused(t, name, 200, body))) took.push(`${name} took ${body}`);
  }
  assert.deepEqual(took, []);
  // Each of these lacks one thing only, or says one thing wrong.
  const lacking: [name: string, body: string][] = [
    ["emails.cancel", `{"id":"m","state":"scheduled"}`],
    ["emails.cancel", `{"id":"m"}`],
    // The email's own record, which is at the path a move is asked at,
    // and says the time it had.
    ["emails.reschedule", `{"id":"m","state":"scheduled","scheduled_at":"2030-01-31T08:00:00Z",${at}}`],
    ["emails.reschedule", `{"id":"m"}`],
    ["emails.reschedule", `{"id":"m","scheduled_at":"0001-01-01T00:00:00Z"}`],
    ["health", up.replace(`"events":"off"`, `"events":""`)],
    ["templates.list", `{"data":[]}`],
    ["suppressions.list", `{"data":[{"domain":"example.com","reason":"manual",${at}}]}`],
    ["suppressions.list", `{"data":[{"address":"a@example.org","reason":"manual",${at}}]}`],
    // A time that was never set is not a time.
    ["emails.get", `{"id":"m","created_at":"0001-01-01T00:00:00Z","updated_at":"2030-01-01T00:00:00Z"}`],
    ["webhooks.get", `{"id":"w","created_at":"0001-01-01T00:00:00Z"}`],
  ];
  for (const [name, body] of lacking) assert.ok(await refused(t, name, 200, body), `${name} took ${body}`);
  // Health says each of its fields.
  const said = JSON.parse(up) as Record<string, string>;
  assert.equal(Object.keys(said).length, 8);
  for (const field of Object.keys(said)) {
    const less = JSON.stringify({ ...said, [field]: undefined });
    assert.ok(await refused(t, "health", 200, less), `health without its ${field}`);
  }
  // A batch says its list also when no email was asked.
  for (const body of ["{}", `{"data":null}`]) {
    const err = await thrown(async () => (await serve(t, 200, body)).client.emails.sendBatch({ emails: [] }));
    assert.ok(err instanceof TransportError && err.reason === "not_cairnpost", `a batch of none took ${body}`);
  }
  assert.deepEqual(await (await serve(t, 200, `{"data":[]}`)).client.emails.sendBatch({ emails: [] }), []);
});

// The table above is held to every call there is: a new call is put in
// front of the same answers, or this fails.
test("every call is in the table", async (t) => {
  const c = (await serve(t, 200, "{}")).client;
  // These read no answer of their own: they walk a call that is there.
  const walks = new Set(["suppressions.all", "webhooks.allDeliveries", "received.all"]);
  // The client, and each part of it: whatever it holds that is an object.
  const parts: [string, object][] = [["", c]];
  for (const [name, part] of Object.entries(c)) {
    if (typeof part === "object" && part !== null) parts.push([name + ".", part as object]);
  }
  assert.deepEqual(parts.map(([prefix]) => prefix).sort(), ["", "emails.", "received.", "suppressions.", "templates.", "webhooks."]);
  for (const [prefix, part] of parts) {
    for (const method of Object.getOwnPropertyNames(Object.getPrototypeOf(part))) {
      const name = prefix + method;
      if (method === "constructor" || walks.has(name)) continue;
      assert.ok(Object.hasOwn(answering, name), `${name} is not in the table of calls`);
    }
  }
});

// A call that answers nothing is done only on CairnPost's own 204.
test("a call that answers nothing wants a 204", async (t) => {
  for (const name of ["webhooks.delete", "templates.delete", "received.delete"]) {
    for (const status of [200, 202]) assert.ok(await refused(t, name, status, ""), `${name} took a ${status}`);
    const c = (await serve(t, 204, "")).client;
    await answering[name]?.(c);
  }
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

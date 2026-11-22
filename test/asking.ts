import type { CairnPost } from "../src/index.ts";

const anEmail = "01a20155-8f2b-76c9-bc68-b2e7bdcd4c56";
const anEndpoint = "01a20155-8f42-7fcf-bf8a-120e8aa42bf6";
const aDelivery = "01a20155-8f59-7f5a-ba31-4cfbc0f1e864";
const aTemplate = "01a20155-9b2b-7b2a-8f83-ef332546a80b";
const aReceived = "01a20155-8f58-7e44-b3a0-1fe938616579";

const welcome = {
  from: "App <app@example.com>",
  to: ["ana@example.org"],
  cc: ["ben@example.org"],
  replyTo: "help@example.com",
  subject: "Welcome",
  text: "Hello.",
  html: "<p>Hello.</p>",
  headers: { "X-Entity-Ref": "42" },
  attachments: [{ filename: "a.txt", content: Buffer.from("hello"), contentType: "text/plain" }],
  idempotencyKey: "welcome-42",
};
const two = ["ana@example.org", "ben@example.org"].map((to) => ({ from: "app@example.com", to: [to], subject: "Welcome", text: "Hello." }));

/**
 * Every call the client has: the name the shared cases know it by, its
 * name here, and the call that sends what calls.json says it sends.
 */
export const asking: [name: string, method: string, ask: (c: CairnPost) => Promise<unknown>][] = [
  ["health", "health", (c) => c.health()],
  ["limits", "limits", (c) => c.limits()],
  ["captured", "captured", (c) => c.captured()],
  ["emails.send", "emails.send", (c) => c.emails.send(welcome)],
  ["emails.send_batch", "emails.sendBatch", (c) => c.emails.sendBatch({ emails: two, idempotencyKey: "batch-7" })],
  ["emails.get", "emails.get", (c) => c.emails.get(anEmail)],
  ["emails.cancel", "emails.cancel", (c) => c.emails.cancel(anEmail)],
  ["emails.reschedule", "emails.reschedule", (c) => c.emails.reschedule(anEmail, new Date("2030-01-31T08:00:00Z"))],
  ["emails.file", "emails.file", (c) => c.emails.file(anEmail, 1)],
  ["suppressions.list", "suppressions.list", (c) => c.suppressions.list({ domain: "example.com", limit: 2 })],
  ["suppressions.add", "suppressions.add", (c) => c.suppressions.add("example.com", "gone@example.org", "asked")],
  ["suppressions.lift", "suppressions.lift", (c) => c.suppressions.lift("example.com", "gone@example.org")],
  ["suppressions.lift_all", "suppressions.liftAll", (c) => c.suppressions.liftAll("example.com", "bounce")],
  [
    "webhooks.create",
    "webhooks.create",
    (c) => c.webhooks.create({ url: "https://app.example.com/hooks/cairnpost", events: ["email.bounced", "email.complained"], description: "Bounces" }),
  ],
  ["webhooks.list", "webhooks.list", (c) => c.webhooks.list()],
  ["webhooks.get", "webhooks.get", (c) => c.webhooks.get(anEndpoint)],
  ["webhooks.update", "webhooks.update", (c) => c.webhooks.update(anEndpoint, { description: "Bounces and complaints", enabled: false })],
  ["webhooks.delete", "webhooks.delete", (c) => c.webhooks.delete(anEndpoint)],
  ["webhooks.rotate_secret", "webhooks.rotateSecret", (c) => c.webhooks.rotateSecret(anEndpoint)],
  ["webhooks.resume", "webhooks.resume", (c) => c.webhooks.resume(anEndpoint)],
  ["webhooks.test", "webhooks.test", (c) => c.webhooks.test(anEndpoint)],
  ["webhooks.deliveries", "webhooks.deliveries", (c) => c.webhooks.deliveries(anEndpoint, { state: "pending", limit: 2 })],
  ["webhooks.retry_delivery", "webhooks.retryDelivery", (c) => c.webhooks.retryDelivery(anEndpoint, aDelivery)],
  [
    "templates.create",
    "templates.create",
    (c) => c.templates.create({ name: "welcome", subject: "Hello {{name}}", text: "Hi {{name}}.", defaults: { name: "there" } }),
  ],
  ["templates.list", "templates.list", (c) => c.templates.list("example.com")],
  ["templates.get", "templates.get", (c) => c.templates.get(aTemplate)],
  ["templates.update", "templates.update", (c) => c.templates.update(aTemplate, { subject: "Welcome {{name}}" })],
  ["templates.delete", "templates.delete", (c) => c.templates.delete(aTemplate)],
  ["received.list", "received.list", (c) => c.received.list({ limit: 2 })],
  ["received.get", "received.get", (c) => c.received.get(aReceived)],
  ["received.raw", "received.raw", (c) => c.received.raw(aReceived)],
  ["received.file", "received.file", (c) => c.received.file(aReceived, 1)],
  ["received.delete", "received.delete", (c) => c.received.delete(aReceived)],
];

/** The call the shared cases know by a name. */
export function ask(name: string): (c: CairnPost) => Promise<unknown> {
  const row = asking.find(([known]) => known === name);
  if (row === undefined) throw new Error(`the cases name "${name}", which is no call of this client`);
  return row[2];
}

/** The names of the calls a case is about: those it lists, or every call there is. */
export function callsOf(where: string, calls: unknown): string[] {
  if (calls === "all") return asking.map(([name]) => name);
  if (Array.isArray(calls) && calls.length > 0 && calls.every((name) => typeof name === "string")) return calls as string[];
  throw new Error(`${where}: its calls are ${JSON.stringify(calls)}`);
}

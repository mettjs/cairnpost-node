<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/logo-dark.svg">
    <img src=".github/logo-light.svg" alt="CairnPost" width="330" height="72">
  </picture>
</p>

# cairnpost-node

The Node.js client for [CairnPost](https://github.com/mettjs/CairnPost), a
self-hostable gateway for transactional email. It sends email, reads what
became of it, manages suppressions, templates and webhook endpoints, reads
the email that comes in, and verifies the webhooks CairnPost sends.

It is written in TypeScript, has no dependencies, and needs Node.js 22 or
later.

**Status: early, and not released yet.** It is built for CairnPost 0.1.1 and
is not on npm. Until it is, install it from this repository:

```sh
npm install github:mettjs/cairnpost-node
```

## Send an email

```ts
import { CairnPost } from "cairnpost";

const client = new CairnPost("https://mail.example.com", process.env.CAIRNPOST_API_KEY);

const sent = await client.emails.send({
  from: "Example <hello@example.com>",
  to: ["ana@example.org"],
  subject: "Welcome",
  text: "Glad you are here.",
  idempotencyKey: "welcome-user-42",
});
```

`sent.id` is the email's id. `html`, `text` or both; `cc`, `bcc`, `replyTo`
and `headers` are optional.

Files go with an email as `attachments`:

```ts
await client.emails.send({
  // ...
  attachments: [
    { filename: "invoice.pdf", content: pdf }, // a Buffer or a Uint8Array
    // Shown in the HTML body as <img src="cid:logo">.
    { filename: "logo.png", content: logo, contentId: "logo" },
  ],
});
```

`contentType` is told from the filename when left out. The server sets how
many files an email may carry and how large they may be in all (10 files and
10 MiB by default). It keeps a file only where it is set to keep what emails
say, for as long, and while an email waits to be sent; `emails.file` reads
one back. Whether a file with a `contentId` can be sent depends on the
server's mail provider.

An email may name several addresses in `to`, `cc` and `bcc` (50 in all,
unless the server is set otherwise). It is still one email with one id. An
address on the sending domain's suppression list is left out and the email
goes to the others: `sent.suppressed` names who was left out, as
`message.suppressed` does when the email is read later. The send is an error
when nobody in `to` or `cc` is left: a `bcc` alone is not sent.

**Use an `idempotencyKey` for anything you may retry.** The same key with the
same content, sent again, is the same email: the retry answers the first
one's id and sends nothing. A key is printable ASCII with no space at either
end; an empty one is refused, since it would be no key at all.

Several emails go in one request with `sendBatch`:

```ts
import { failed } from "cairnpost";

const results = await client.emails.sendBatch({ emails, idempotencyKey: "welcome-run-42" });
// It throws when the batch was refused whole (one email could never be
// sent, say): nothing was sent then.
for (const [i, r] of results.entries()) {
  if (r.error) {
    // Email i did not go: the same CairnPostError a send would throw.
    continue;
  }
  // r.sent.id
}
```

An answer says the batch was taken, not that every email went: read each
result, or count with `failed(results)`. With an `idempotencyKey` on the
batch, the same batch sent again (the same emails in the same order) sends
only what did not go. Each failed email's `retryAfterMs` is its own. The
server sets how many emails a batch may hold (100 by default) and how long
it may take; a server given more than its default minute wants a client with
a longer `timeoutMs`.

An email can be asked for now and sent later:

```ts
const sent = await client.emails.send({
  // ...
  scheduledAt: new Date(Date.now() + 24 * 3600 * 1000),
});
// sent.scheduledAt is when it goes; nothing was sent yet.

await client.emails.reschedule(sent.id, new Date(Date.now() + 48 * 3600 * 1000));
await client.emails.cancel(sent.id);
```

Until its time the email's `state` is `State.scheduled`; from then on it is
an email like any other, under the same id. `cancel` and `reschedule` throw
a `CairnPostError` with the code `not_scheduled` once the email is being
sent, was sent or was cancelled. The server keeps what a waiting email says,
and its files, until it is sent or cancelled. An address suppressed by the
time the email goes is left out; with nobody left in `to` or `cc`, the email
is cancelled and `message.reason` says `"suppressed"`. Revoking an API key
cancels the emails it asked for that still wait. The emails of a batch may
each have a `scheduledAt`. An `idempotencyKey` is remembered for a day from
the asking, not until the email goes.

## Templates

A template is an email the server keeps, written once with variables as
`{{name}}`. An admin key keeps one, and any key sends from it:

```ts
await admin.templates.create({
  name: "welcome",
  subject: "Welcome, {{name}}",
  html: "<p>Your code is <b>{{code}}</b></p>",
  text: "Your code is {{code}}",
  defaults: { name: "there" },
});

await client.emails.send({
  from: "app@example.com",
  to: ["ana@example.org"],
  template: { name: "welcome", variables: { code: "4821" } },
});
```

Leave `html` and `text` out with a `template`; a `subject` given with it is
used instead of the template's. A value is written as it is in the subject
and the text and escaped in the HTML, so it is never markup there: keep
attributes in quotes (`href="{{link}}"`). A variable with no default must be
given, and a value for a variable the template does not name is refused:
both are a `CairnPostError` with status 422, and nothing is sent. The email
is filled when it is asked for, so one that waits (`scheduledAt`) keeps what
it was filled with whatever becomes of the template. A template belongs to a
sending domain or, with no `domain` and a key bound to none, serves every
domain; a send gets its own domain's template of that name first.

## When a send fails

The client never retries by itself. The error says what happened:

```ts
import { CairnPostError, ErrorCode, mayHaveSent } from "cairnpost";

try {
  const sent = await client.emails.send(email);
  // Sent. Keep sent.id.
} catch (err) {
  if (err instanceof CairnPostError && err.code === ErrorCode.recipientSuppressed) {
    // The address bounced for good, complained, or was blocked by hand
    // (everyone in to and cc, if the email named several). Nothing was
    // sent now, and nothing will be: stop sending to it, and do not
    // retry. If err.emailId is set, an earlier try under the same key got
    // no answer and may have gone: emails.get(err.emailId) says what
    // became of it.
  } else if (mayHaveSent(err)) {
    // It is not known whether the email went. Try again later with the
    // same idempotencyKey, and only with it. Ask this before the cases
    // below: they mean "nothing was sent" only after it.
  } else if (err instanceof CairnPostError && err.retryable) {
    // Nothing was sent. Try again, after err.retryAfterMs if it is set.
  } else {
    // The request is at fault, or the key is. Trying again will not help.
  }
}
```

| Error | Meaning |
|---|---|
| `CairnPostError`, status 422 | The request is at fault and will never succeed. `recipient_suppressed` is one of them. |
| `CairnPostError`, 409 `invalid_idempotent_request` | The key was used for a different email, which was sent. |
| `CairnPostError`, 409 `concurrent_idempotent_requests`, 408 `request_incomplete`, 429, 503 | Nothing was sent. Try again, after `retryAfterMs` when set. The 408 is a request that did not arrive whole in time, a 503 can be a server busy with other large emails. |
| `CairnPostError`, 502 `upstream_unknown` | The mail provider did not answer. The email may have gone. |
| `CairnPostError`, any other 5xx but the 503s above, or a 408 that is not CairnPost's own | The server failed after it began, or something in between answered for it (a proxy's 502 or 408). The email may have gone. |
| `TransportError` | The server was not reached, its answer never came or was not CairnPost's, or the call ran out of time or was cancelled; `reason` says which, and `causeCode` holds the runtime's short name for it (`ECONNREFUSED`, say) when it gave one. For a send, the email may have gone. |
| `TypeError` | What was given to the client cannot be sent as it is (an `idempotencyKey` a header cannot carry, a date that is none). Nothing was sent. |

`mayHaveSent` is true for the fourth, fifth and sixth, and for a
`recipient_suppressed` that carries an `emailId`: nothing was sent now, but
an earlier try under the same key got no answer and may have gone. That one
is not retried: the address is suppressed. For the others, the retry that
`mayHaveSent` asks for is not a promise of one email: when the mail
provider's answer was lost, the server lets a retry through after a short
wait, because an email that arrives twice is better than one that never
does.

On a `CairnPostError`, `code` is the server's name for the error (see
`ErrorCode`), `detail` its sentence for a person, and `emailId`, when set,
the email's id on the server: `emails.get` says what became of it. `code`
and `detail` are undefined when the answer was not CairnPost's own. No error
holds the email's subject or body, or the API key; an answer that is not
CairnPost's own is never quoted, and the runtime's own error is not kept as
a `cause`, since it can hold what the other side answered. `retryable` is
also true of a 409 `changed_meanwhile`, which a template change can meet:
read the template and try again.

The client does not follow redirects, which would turn a send into a request
with no email in it: give it the server's own address. An API key is sent
without the spaces or newline around it, and is not shown when a client is
printed or logged.

A call may take two and a half minutes, longer than the server takes for its
slowest answer: a batch, which may take 30 seconds to arrive, starts emails
for a minute and then waits for the mail provider on the last of them, two
minutes in all. If you set `timeoutMs`, keep it above that (and higher still
if the server's send or batch timeout was raised): a client that gives up
first cannot know whether its emails went. Node's own `fetch` gives up after
five minutes without an answer, whatever `timeoutMs` says: for a server set
to take longer than that, pass a `fetch` of your own. Every call also takes
a `signal`, to end it from outside.

## What became of an email

```ts
const m = await client.emails.get(id);
console.log(m.state); // scheduled, cancelled, sending, sent, deferred, delivered, bounced, complained, failed, unknown
for (const r of m.recipients) {
  console.log(r.address, r.kind, r.state); // each address has its own outcome
}
for (const e of m.events) {
  console.log(e.to, e.type, e.at, e.code, e.reason);
}
```

`m.to` and `m.state` are the first address and what became of the email
there; for an email to several, read `m.recipients`: `failed` at one address
does not say the email went to nobody. Times are `Date`s.

A send key sees the emails it sent; an admin key sees any, or its sending
domain's if it is bound to one. `isNotFound(err)` says there is no such
email: the id is wrong, another key's, or older than the server keeps
records. `isWrongAddress(err)` says something else: the request reached no
route of CairnPost's, so the base URL given to the client is most likely
wrong, and no record is known to be missing. `client.health()` fails the
same way on a wrong base URL, so it is the call to check a configuration
with. (Both need the server's own error answers to arrive: a proxy that puts
its own page in place of every 404 makes a missing record read as a wrong
address.) `m.content` is what the email said, set only when the server keeps
content and the key is an admin key.

## Webhooks

CairnPost tells your application what becomes of its emails by posting to a
URL of yours. Each webhook is signed; verify it before you trust it:

```ts
import http from "node:http";
import { BounceType, EventType, Verifier, WebhookError } from "cairnpost";

const verifier = new Verifier(process.env.CAIRNPOST_WEBHOOK_SECRET);

http.createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  let event;
  try {
    event = verifier.verify(req.headers, Buffer.concat(chunks)); // the body exactly as it arrived
  } catch (err) {
    if (!(err instanceof WebhookError)) throw err; // a mistake in this code, not a bad webhook
    return res.writeHead(401).end("not a CairnPost webhook");
  }
  if (event.type === EventType.bounced && event.email.bounce.type === BounceType.permanent) {
    // The address will never take mail.
  } else if (event.type === EventType.complained) {
    // Its owner marked the email as spam.
  }
  res.writeHead(204).end();
});
```

- `verify` takes the headers as `node:http` or `fetch` gives them, and the
  body as bytes or as the text they are. Give it the body before anything
  parses it: a body read as JSON and written again is not the body that was
  signed. Limit how much of a body you read (1 MiB is plenty).
- A `TypeError` from `verify` is not about the webhook: the call itself is
  wrong (a body already parsed, a missing argument).
- It throws a `WebhookError` whose `reason` is `"signature"` for a wrong
  signature, `"unsigned"` for missing headers, and `"stale"` for a timestamp
  more than five minutes from now, which is what stops a captured webhook
  being replayed.
- `event.id` is the same on every try of a webhook. CairnPost retries one
  that was not answered with a 2xx, and may send one twice: act once per id.
- `event.email` is set for `email.delivered`, `email.delivery_delayed`,
  `email.bounced`, `email.complained` and `email.failed`, and
  `event.email.bounce` for `email.bounced`; a webhook of those types that
  lacks them is refused (`"payload"`). `event.email` is undefined for
  `webhook.test`, the webhook sent to try an endpoint out. A type this
  client does not know is passed on as it is, with what could be read of it.
- `event.email.to` holds the one address the event is about, also when the
  email went to several; `event.email.id` is the email's one id.
- `email.received` (`EventType.received`) tells of an email that came for
  one of your addresses, where the server takes them. It is about no email
  you sent: `event.received` says who it is from and for, and the id to read
  it by (see "Receiving email"). An endpoint that hears about every event
  gets these too.
- `address.suppressed` (`EventType.addressSuppressed`) tells of an address
  suppressed because of a bounce or a complaint about an email the server
  has no record of. It names no email: `event.suppression` holds the sending
  domain, the address and the reason (`Reason.bounce` or
  `Reason.complaint`). Treat it as you treat an `email.bounced` or an
  `email.complained` with `suppressed` set.
- Of the three bounce types only `BounceType.permanent` says the address is
  at fault. `BounceType.policy` is a refusal over the sender (a failed
  signature, a blocklist); the address may be perfectly good.
- `event.email.suppressed` says CairnPost will now refuse to send to that
  address from that sending domain.

The signature is the Standard Webhooks scheme, which Svix also uses, so any
verifier for either works too.

## Receiving email

A server set up to take the emails that come for its domains' addresses
keeps each for a time (7 days by default) and tells your endpoint with an
`email.received` webhook. Read it with an admin key:

```ts
if (event.type === EventType.received) {
  const got = await admin.received.get(event.received.id);
  // got.content.subject, .text, .html, .attachments ...
  const pdf = await admin.received.file(got.id, 1); // its first file
  const raw = await admin.received.raw(got.id); // every byte, as it came
}
```

A stranger wrote it: treat every part as untrusted, and never show its HTML
as a page. `got.from` is what the sending server said and `got.content.from`
what the email says of itself; either can be made up. `content.partial` says
some of it could not be read as it was written (a charset the server does
not know); `received.raw` always has all of it. `received.list` and
`received.all` list what is kept, and `received.delete` deletes one before
its time. `isNotFound` says an email's time is up.

## With an admin key

```ts
// Webhook endpoints. The secret is said only here: keep it.
let w = await admin.webhooks.create({
  url: "https://app.example.com/webhooks/cairnpost",
  events: [EventType.bounced, EventType.complained],
});
console.log(w.secret);

const res = await admin.webhooks.test(w.id); // sends a webhook.test now

// A new signing secret, said only here. Until w.previousSecretUntil the
// server signs with the old one too: change the application's secret
// within that time. If it is undefined, the old one has stopped already.
w = await admin.webhooks.rotateSecret(w.id);

await admin.webhooks.update(w.id, { enabled: false });

for await (const d of admin.webhooks.allDeliveries(w.id, DeliveryState.failed)) {
  await admin.webhooks.retryDelivery(w.id, d.id);
}

// The suppression list.
for await (const s of admin.suppressions.all("example.com")) {
  console.log(s.address, s.reason);
}
await admin.suppressions.add("example.com", "ana@example.org", "asked to stop");
await admin.suppressions.lift("example.com", "ana@example.org");
await admin.suppressions.liftAll("example.com", Reason.bounce);
```

| Calls | Do |
|---|---|
| `webhooks.create`, `list`, `get`, `update`, `delete` | Manage the URLs told what becomes of emails. |
| `webhooks.test` | Send an endpoint a signed `webhook.test` and say how it answered. |
| `webhooks.rotateSecret` | Give an endpoint a new signing secret; the old one still signs for a day, unless the server is set otherwise. |
| `webhooks.resume` | End an endpoint's pause, and have what it is owed sent. |
| `webhooks.deliveries`, `allDeliveries`, `retryDelivery` | What an endpoint was sent and how each went; try one again now. |
| `suppressions.list`, `all` | The addresses not sent to, a page at a time or all of them. |
| `suppressions.add`, `lift`, `liftAll` | Block an address for a sending domain, or let it be sent to again. |
| `received.get`, `list`, `all`, `raw`, `file`, `delete` | The emails that came for your addresses, while the server keeps them. |
| `templates.create`, `list`, `get`, `update`, `delete` | Manage the templates emails are sent from. `name_taken` for a name its domain has. |
| `emails.file` | What one of an email's files held, where the server keeps it (`kept` says so). |
| `captured` | The emails a development server (capture driver) kept instead of sending; a `NotCapturingError` from a server that delivers for real. |

In a change (`webhooks.update`, `templates.update`) a field left out is left
as it is, and a field that is set is changed to exactly that: `enabled:
false` disables the endpoint, `events: []` makes it hear about every type.

The `all` calls walk a whole list a page at a time, and throw the first
error they meet. A page of `list` or `deliveries` holds `data` and, when
more follow, `next`: pass it back as `after`.

An endpoint that fails every try for days is paused by the server:
`w.pausedAt` is set, nothing is sent to it, and it is still owed everything
that happens. `admin.webhooks.resume(w.id)` resumes it, and what it is owed
is sent then; an `update` never does. `w.failingSince` says since when every
try has failed.

## The server itself

```ts
const h = await client.health(); // needs no key
console.log(h.ok, h.events, h.webhooks, h.pruning);

const l = await client.limits(); // l.quota is undefined for a provider with no allowance
```

## Options

The third argument of `new CairnPost(baseUrl, apiKey, options)`:

| Option | Does |
|---|---|
| `timeoutMs` | How long a call may take (150 000 by default), a whole number. Keep it above the server's send and batch timeouts. |
| `maxAnswerBytes` | How much of an answer is read (64 MiB by default). A larger one is an error that says so. A refusal is not counted: 64 KiB of one are read, and a longer one is its status alone. |
| `userAgent` | Put your application's name before the client's in `User-Agent`. |
| `fetch` | Call through your own `fetch`. It must not retry by itself. |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)

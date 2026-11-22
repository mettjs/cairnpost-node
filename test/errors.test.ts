import assert from "node:assert/strict";
import { once } from "node:events";
import net from "node:net";
import { test } from "node:test";
import { inspect } from "node:util";
import { CairnPost, CairnPostError, isWrongAddress, mayHaveSent, TransportError } from "../src/index.ts";
import { email, key, serve, serving, thrown } from "./stand.ts";

// What an error says to do is in the shared cases (cases-errors.test.ts).

// An error never repeats what the email said or the key that sent it,
// whatever went wrong and whatever the server answered.
test("no error holds the email's words or the key", async (t) => {
  const marked = {
    from: "NAMEMARK <app@example.com>",
    to: ["ana@example.org"],
    subject: "SUBJECTMARK",
    text: "TEXTMARK",
    html: "<p>HTMLMARK</p>",
    headers: { "X-Trace": "HEADERMARK" },
    attachments: [{ filename: "FILEMARK.txt", content: Buffer.from("BYTESMARK") }],
    idempotencyKey: "IDEMMARK",
  };
  // The last is the file's bytes as they travel.
  const marks = ["NAMEMARK", "SUBJECTMARK", "TEXTMARK", "HTMLMARK", "HEADERMARK", "KEYMARK", "FILEMARK", "BYTESMARK", "QllURVNNQVJL", "IDEMMARK"];
  const check = (why: string, err: unknown) => {
    // All of it: the message, the fields, and what lies underneath.
    const all = inspect(err, { depth: 9, showHidden: true }) + JSON.stringify(err) + String((err as Error).stack);
    for (const mark of marks) assert.ok(!all.includes(mark), `${why}: the error holds ${mark}: ${all}`);
  };
  // A server that echoes the request in a body that is not CairnPost's.
  const echo = (status: number, field: string) =>
    serving(t, (res, _n, seen) => res.writeHead(status).end(JSON.stringify({ name: "BadRequestError", [field]: seen.body + seen.auth + seen.idem })));
  check("an answer that echoes the request", await thrown(async () => (await echo(500, "error")).client.emails.send(marked)));
  // The same, in the shape of CairnPost's own error under another name.
  const shaped = await thrown(async () => (await echo(400, "message")).client.emails.send(marked));
  check("an error of CairnPost's shape that is not CairnPost's", shaped);
  assert.ok(shaped instanceof CairnPostError && shaped.code === undefined && shaped.detail === undefined);
  const s = await serve(t, 200, "SUBJECTMARK is not JSON, KEYMARK");
  const notJson = await thrown(() => s.client.emails.send(marked));
  check("an answer that is not JSON", notJson);
  assert.ok(notJson instanceof TransportError && notJson.reason === "not_cairnpost");
  // Something that is not a web server at all, and says back what it was
  // sent: the runtime's own error holds those bytes.
  const parrot = net.createServer((socket) => socket.pipe(socket)).listen(0, "127.0.0.1");
  t.after(() => parrot.close());
  await once(parrot, "listening");
  const echoed = await thrown(() => new CairnPost(`http://127.0.0.1:${(parrot.address() as net.AddressInfo).port}`, key).emails.send(marked));
  check("a peer that echoes the request", echoed);
  assert.ok(echoed instanceof TransportError && echoed.reason === "network" && echoed.cause === undefined);
  // A server that is not there.
  const closed = net.createServer().listen(0, "127.0.0.1");
  await once(closed, "listening");
  const free = (closed.address() as net.AddressInfo).port;
  closed.close();
  await once(closed, "close");
  const gone = new CairnPost(`http://127.0.0.1:${free}`, key);
  const none = await thrown(() => gone.emails.send(marked));
  check("no server", none);
  assert.ok(none instanceof TransportError && none.causeCode === "ECONNREFUSED", "the runtime's short name for it is kept");
  assert.ok(mayHaveSent(none), "a send with no answer was said not to have gone");
  // A call that runs out of time.
  const slow = await serving(t, () => {}, { timeoutMs: 20 });
  check("a timeout", await thrown(() => slow.client.emails.send(marked)));
  // What the caller gave wrongly is not repeated either.
  check("a key no header carries", await thrown(() => s.client.emails.send({ ...marked, idempotencyKey: "IDEMMARK\n2" })));
  assert.ok((await thrown(() => s.client.emails.send({ ...marked, idempotencyKey: "" }))) instanceof TypeError, "an empty key is no key, where one was meant");
});

test("Retry-After as a date is read, and anything else is not", async (t) => {
  const s = await serving(t, (res, n) => {
    const after = [new Date(Date.now() + 90_000).toUTCString(), "soon", "-5", "2030", new Date(Date.now() - 90_000).toUTCString()][n - 1] ?? "";
    res.writeHead(503, { "retry-after": after }).end();
  });
  const first = await thrown(() => s.client.emails.send(email));
  assert.ok(first instanceof CairnPostError && first.retryAfterMs !== undefined && first.retryAfterMs >= 80_000 && first.retryAfterMs <= 91_000);
  for (const odd of ["soon", "-5", "2030 as seconds", "a date gone by"]) {
    const err = await thrown(() => s.client.emails.send(email));
    assert.ok(err instanceof CairnPostError);
    assert.equal(err.retryAfterMs, odd.startsWith("2030") ? 2_030_000 : undefined, odd);
  }
});

// The server's own sentence is kept, so the error says what to check; and
// no answer at all is not a wrong address.
test("a wrong address says what to check", async (t) => {
  const said = await serve(t, 404, `{"statusCode":404,"name":"route_not_found","message":"Check the path and the server's address."}`);
  const err = await thrown(() => said.client.emails.get("0199"));
  assert.ok(err instanceof CairnPostError && err.message.includes("Check the path and the server's address") && err.detail === "Check the path and the server's address.");
  assert.ok(!isWrongAddress(undefined) && !isWrongAddress(new TransportError("network")), "no answer at all is not a wrong address");
});

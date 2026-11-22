import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { TestContext } from "node:test";
import { serving, type Stand } from "./stand.ts";

// The files in test/cases are the cases every CairnPost client is held
// to, whatever language it is written in: what each call sends, the
// answers a client must take and those it must refuse, what an error
// says to do, and which webhooks are the endpoint's. They are a copy of
// the server's own (client-cases in its repository) and are changed
// there, never here. The tests in cases-*.test.ts run them.

/** An answer for a server to give: its body is JSON, written in the file as it is, or a text. */
export interface Said {
  status: number;
  json?: unknown;
  text?: string;
  headers?: Record<string, string>;
}

/**
 * Says a case holds no field but those named. A field this runner does
 * not know fails the read: a case must never pass because part of it
 * was not looked at.
 */
export function only(where: string, value: unknown, known: string[]): void {
  assert.ok(typeof value === "object" && value !== null && !Array.isArray(value), `${where} is not an object`);
  const strange = Object.keys(value).filter((name) => !known.includes(name));
  assert.deepEqual(strange, [], `${where} has a field this runner does not know`);
}

/** Reads one of the shared files. */
export function cases(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(new URL(`./cases/${name}`, import.meta.url), "utf8")) as Record<string, unknown>;
}

/** The cases under one name of a file: a list that is not empty. */
export function listed<T>(file: Record<string, unknown>, name: string): T[] {
  const list = file[name];
  assert.ok(Array.isArray(list) && list.length > 0, `the file holds no ${name}`);
  return list as T[];
}

/** Starts a server that gives one answer to every request, and a client of it. */
export function saying(t: TestContext, a: Said): Promise<Stand> {
  only("an answer", a, ["status", "json", "text", "headers"]);
  assert.notEqual("json" in a, "text" in a, "an answer has a json or a text, and not both");
  const body = "json" in a ? JSON.stringify(a.json) : (a.text ?? "");
  const headers = { ...("json" in a ? { "content-type": "application/json" } : {}), ...a.headers };
  return serving(t, (res) => res.writeHead(a.status, headers).end(body));
}

const aTime = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?(Z|[+-]\d\d:\d\d)$/;

/** Puts every time in a JSON value into one form: a time is the instant it names, however it is written. */
export function instants(v: unknown): unknown {
  if (typeof v === "string") return aTime.test(v) ? { instant: Date.parse(v) } : v;
  if (Array.isArray(v)) return v.map(instants);
  if (typeof v === "object" && v !== null) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, instants(x)]));
  return v;
}

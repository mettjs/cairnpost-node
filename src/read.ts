// Readers for what a server answered. An answer is not trusted to have
// the shape CairnPost gives: a field of another kind than expected throws
// Misshapen, which the caller turns into "not a CairnPost answer". A field
// that is missing, or null, reads as nothing.

/** An answer, or a part of one, that is not of the kind CairnPost gives. */
export class Misshapen extends Error {
  constructor() {
    super("not the shape a CairnPost server gives");
  }
}

export type Fields = Record<string, unknown>;

/** The value as an object with fields; nothing reads as one with none. */
export function fields(v: unknown): Fields {
  if (v === undefined || v === null) return {};
  if (typeof v !== "object" || Array.isArray(v)) throw new Misshapen();
  return v as Fields;
}

/**
 * The object, once it is seen to name each of these fields. An answer
 * that lacks what CairnPost always says ("{}" above all) is not
 * CairnPost's, and must not read as "nothing" or "no".
 */
export function has(o: Fields, ...keys: string[]): Fields {
  for (const key of keys) {
    if (o[key] === undefined || o[key] === null || !Object.hasOwn(o, key)) throw new Misshapen();
  }
  return o;
}

/** A text field; "" when it is not there. */
export function text(o: Fields, key: string): string {
  return maybeText(o, key) ?? "";
}

/** A text field; undefined when it is not there or empty. */
export function maybeText(o: Fields, key: string): string | undefined {
  const v = o[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") throw new Misshapen();
  return v === "" ? undefined : v;
}

/** A whole number; 0 when it is not there. */
export function count(o: Fields, key: string): number {
  const v = o[key];
  if (v === undefined || v === null) return 0;
  if (typeof v !== "number" || !Number.isSafeInteger(v)) throw new Misshapen();
  return v;
}

/** A yes or no; false when it is not there. */
export function flag(o: Fields, key: string): boolean {
  const v = o[key];
  if (v === undefined || v === null) return false;
  if (typeof v !== "boolean") throw new Misshapen();
  return v;
}

// A time as CairnPost writes one: RFC 3339, with a zone.
const stamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/** A time; undefined when it is not there. */
export function maybeTime(o: Fields, key: string): Date | undefined {
  const v = o[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string" || !stamp.test(v)) throw new Misshapen();
  const at = new Date(v);
  if (Number.isNaN(at.getTime())) throw new Misshapen();
  return at;
}

/** A time that must be there. */
export function time(o: Fields, key: string): Date {
  const at = maybeTime(o, key);
  if (at === undefined) throw new Misshapen();
  return at;
}

/** A list, each item read by `read`; empty when it is not there. */
export function list<T>(o: Fields, key: string, read: (item: unknown) => T): T[] {
  const v = o[key];
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new Misshapen();
  return v.map(read);
}

/** A list of texts; empty when it is not there. */
export function texts(o: Fields, key: string): string[] {
  return list(o, key, (item) => {
    if (typeof item !== "string") throw new Misshapen();
    return item;
  });
}

/** Names with a text each (an email's headers); undefined when not there. */
export function textMap(o: Fields, key: string): Record<string, string> | undefined {
  const v = o[key];
  if (v === undefined || v === null) return undefined;
  const pairs = Object.entries(fields(v)).map(([name, value]): [string, string] => {
    if (typeof value !== "string") throw new Misshapen();
    return [name, value];
  });
  // Defined one by one: a name such as "__proto__" stays a name.
  return Object.fromEntries(pairs);
}

/** A part that is an object, read by `read`; undefined when not there. */
export function part<T>(o: Fields, key: string, read: (v: Fields) => T): T | undefined {
  const v = o[key];
  return v === undefined || v === null ? undefined : read(fields(v));
}

/** Leaves out the fields that hold nothing, so an optional one is absent. */
export function present<T extends object>(o: { [K in keyof T]: T[K] | undefined }): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(o)) {
    if (value !== undefined) out[key] = value;
  }
  return out as T;
}

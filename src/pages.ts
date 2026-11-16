import { fields, has, list, maybeText, present } from "./read.ts";

/** One page of a list. */
export interface Page<T> {
  data: T[];
  /** What to pass as `after` for the page that follows; undefined when this is the last. */
  next?: string;
}

/** The most a server gives in one page of any list: what reading a whole list asks for. */
export const largestPage = 200;

/** The query of a paged list. */
export function paging(limit: number | undefined, after: string | undefined): Record<string, string | undefined> {
  return { limit: limit !== undefined && limit > 0 ? String(limit) : undefined, after: after || undefined };
}

/**
 * Goes through a paged list a page at a time: `page` answers the items
 * after a cursor (undefined for the first page). It ends at the first
 * error, which it throws.
 */
export async function* walk<T>(page: (after: string | undefined) => Promise<Page<T>>): AsyncGenerator<T, void, void> {
  let after: string | undefined;
  for (;;) {
    const { data, next } = await page(after);
    yield* data;
    // A cursor that does not move would be walked for ever.
    if (next === undefined || next === after) return;
    after = next;
  }
}

/** Reads one page of a list whose items `read` reads. */
export function readPage<T>(v: unknown, read: (item: unknown) => T): Page<T> {
  const o = has(fields(v), "data");
  return present<Page<T>>({ data: list(o, "data", read), next: maybeText(o, "next") });
}

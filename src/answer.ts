import { TransportError } from "./errors.ts";
import { Misshapen } from "./read.ts";

/** Runs a reader over an answer; one of another shape is not CairnPost's. */
export function reading<T>(answer: unknown, read: (v: unknown) => T): T {
  try {
    return read(answer);
  } catch (err) {
    if (err instanceof Misshapen) throw new TransportError("not_cairnpost");
    throw err;
  }
}

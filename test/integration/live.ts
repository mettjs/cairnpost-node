import { CairnPost } from "../../src/index.ts";

// These tests run against a real CairnPost server: one started with the
// capture driver, CAIRNPOST_WEBHOOK_ALLOW_PRIVATE=on, a
// CAIRNPOST_CONTENT_RETENTION and a CAIRNPOST_INBOUND_SECRET, so that
// nothing is sent to anybody, a webhook can reach this machine, and
// content and received mail can be read back. They need its address, two
// keys and that secret, and fail without them rather than skip.
function need(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error("set CAIRNPOST_URL, CAIRNPOST_SEND_KEY, CAIRNPOST_ADMIN_KEY and CAIRNPOST_INBOUND_SECRET to a server running the capture driver");
  }
  return value;
}

export const url = need("CAIRNPOST_URL");
export const inboundSecret = need("CAIRNPOST_INBOUND_SECRET");
export const send = new CairnPost(url, need("CAIRNPOST_SEND_KEY"));
export const admin = new CairnPost(url, need("CAIRNPOST_ADMIN_KEY"));

/** A name no other run has. */
export const run = `run-${Date.now()}-${process.pid}`;

/** The error's code; undefined for anything that is not CairnPost's. */
export async function code(run: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await run();
  } catch (err) {
    return (err as { code?: string }).code ?? `thrown: ${String(err)}`;
  }
  return "no error";
}

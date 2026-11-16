import { ErrorCode } from "./codes.ts";
import { CairnPostError, TransportError } from "./errors.ts";

/**
 * Says whether, after a failed send, the email may have gone all the
 * same: the mail provider's answer was lost (`upstream_unknown`), the
 * server's own answer never came or came from something in between (a
 * proxy's 502), or the server failed after it began. Then the only safe
 * retry is one with the same idempotency key. It is also true of a
 * `recipient_suppressed` that carries an `emailId`: nothing was sent now,
 * but that earlier try may have gone. That one is not to be retried,
 * since the address is suppressed: read the `emailId` with `emails.get`
 * instead. After any other error nothing was sent.
 */
export function mayHaveSent(err: unknown): boolean {
  if (err instanceof TransportError) return true;
  if (!(err instanceof CairnPostError)) return false;
  // Refused now; but an id with it is an earlier try under the same key
  // whose answer never came.
  if (err.code === ErrorCode.recipientSuppressed) return err.emailId !== undefined;
  // CairnPost's own 408 is a request it never had whole. One from
  // something in between may come after the server took the email.
  if (err.status === 408) return err.code !== ErrorCode.requestIncomplete;
  if (err.status < 500) return false;
  // The server's send does not stop when its answer is lost on the way,
  // so only its own word that nothing went counts.
  return (
    err.code !== ErrorCode.upstreamDown &&
    err.code !== ErrorCode.unavailable &&
    err.code !== ErrorCode.notStarted &&
    err.code !== ErrorCode.scheduleFull
  );
}

/**
 * Says that what was asked for is not there: no such email, endpoint,
 * delivery or suppression, or not one this key may see. It is CairnPost's
 * own word for it: a path the server does not have, or a 404 from
 * something else at that address, is not this. `isWrongAddress` says
 * those.
 *
 * It needs the server's own answer to arrive. Behind a proxy that puts
 * its own page in place of every 404, no record is ever said to be
 * missing and every such answer reads as a wrong address: have the proxy
 * pass the server's error answers through.
 */
export function isNotFound(err: unknown): boolean {
  return err instanceof CairnPostError && err.status === 404 && err.code === ErrorCode.notFound;
}

/**
 * Says that the request did not reach a route of CairnPost's: the server
 * has nothing at that path or does not take that method there, or
 * something else answered in its place with a 404, a 405 or a redirect.
 * The base URL given to the client is most likely wrong; nothing was
 * sent, and no record is known to be missing.
 */
export function isWrongAddress(err: unknown): boolean {
  if (!(err instanceof CairnPostError)) return false;
  if (err.code === ErrorCode.routeNotFound || err.code === ErrorCode.methodNotAllowed) return true;
  if (err.code !== undefined) return false;
  return err.status === 404 || err.status === 405 || (err.status >= 300 && err.status < 400);
}

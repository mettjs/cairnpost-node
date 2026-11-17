import { type EventEmail, type EventReceived, EventType, type WebhookEvent } from "./events.ts";
import { type Fields, fields, flag, maybeText, maybeTime, Misshapen, part, present, text, texts, time } from "./read.ts";

// The types that are about an email that was sent.
const aboutAnEmail = new Set<string>([EventType.delivered, EventType.deliveryDelayed, EventType.bounced, EventType.complained, EventType.failed]);

function readEmail(o: Fields): EventEmail {
  return present<EventEmail>({
    id: text(o, "email_id"),
    from: text(o, "from"),
    to: texts(o, "to"),
    createdAt: maybeTime(o, "created_at"),
    code: maybeText(o, "code"),
    reason: maybeText(o, "reason"),
    bounce: part(o, "bounce", (b) => ({ type: text(b, "type") })),
    suppressed: flag(o, "suppressed"),
  });
}

/** Reads a signed body. Whatever it throws is a body that cannot be read. */
export function readEvent(id: string, body: unknown): WebhookEvent {
  const wire = fields(body);
  const event: WebhookEvent = { id, type: text(wire, "type"), at: time(wire, "created_at") };
  if (event.type === "") throw new Misshapen();
  const data = fields(wire["data"]);
  if (event.type === EventType.received) {
    // It is about an email that came, and must say which, for whom and
    // when.
    const received: EventReceived = {
      id: text(data, "inbound_id"),
      from: text(data, "from"),
      to: texts(data, "to"),
      receivedAt: time(data, "received_at"),
    };
    if (received.id === "" || received.to.length === 0) throw new Misshapen();
    return { ...event, received };
  }
  let email: EventEmail | undefined;
  try {
    email = readEmail(data);
  } catch {
    email = undefined;
  }
  const known = aboutAnEmail.has(event.type);
  if (email !== undefined && email.id !== "" && email.to.length > 0 && (email.createdAt !== undefined || !known)) {
    event.email = email;
  } else if (known) {
    // An event about an email must say which, and when that email was
    // made: one that does not is refused here, not handed on with
    // nothing in it. A type this client does not know is passed on with
    // what could be read of it.
    throw new Misshapen();
  }
  if (event.type === EventType.bounced && !event.email?.bounce?.type) throw new Misshapen();
  if (event.type === EventType.addressSuppressed) {
    // It must say which address and why, as an email's event must say
    // which email.
    const suppression = { domain: text(data, "domain"), address: text(data, "address"), reason: text(data, "reason") };
    if (suppression.domain === "" || suppression.address === "" || suppression.reason === "") throw new Misshapen();
    event.suppression = suppression;
  }
  return event;
}

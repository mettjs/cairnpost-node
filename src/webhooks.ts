import { reading } from "./answer.ts";
import { type Delivery, type DeliveryQuery, readDelivery } from "./deliveries.ts";
import { largestPage, type Page, paging, readPage, walk } from "./pages.ts";
import { type NewWebhook, readWebhook, type Webhook, type WebhookChange, type WebhookTest } from "./endpoint.ts";
import { named } from "./emails.ts";
import { count, fields, flag, has, list, maybeText, present } from "./read.ts";
import type { CallOptions, Transport } from "./transport.ts";

/** The URLs told what becomes of emails. Every call needs an admin key. */
export class Webhooks {
  readonly #t: Transport;

  /** @internal */
  constructor(transport: Transport) {
    this.#t = transport;
  }

  /** Has a URL told what becomes of emails. The answer carries the endpoint's signing `secret`, the only time it is said. */
  async create(n: NewWebhook, options: CallOptions = {}): Promise<Webhook> {
    const body = {
      url: n.url,
      domain: n.domain || undefined,
      events: n.events && n.events.length > 0 ? n.events : undefined,
      description: n.description || undefined,
    };
    return reading(await this.#t.json({ method: "POST", path: ["webhooks"], body, signal: options.signal }), readWebhook);
  }

  /** Answers every endpoint. */
  async list(options: CallOptions = {}): Promise<Webhook[]> {
    const answer = await this.#t.json({ method: "GET", path: ["webhooks"], signal: options.signal });
    return reading(answer, (v) => list(has(fields(v), "data"), "data", readWebhook));
  }

  /** Answers one endpoint. */
  async get(id: string, options: CallOptions = {}): Promise<Webhook> {
    return reading(await this.#t.json({ method: "GET", path: ["webhooks", id], signal: options.signal }), readWebhook);
  }

  /**
   * Changes an endpoint and answers it as it now is. A disabled endpoint
   * is owed nothing new, and what it was owed waits. It does not resume a
   * paused endpoint: `resume` does.
   */
  async update(id: string, change: WebhookChange, options: CallOptions = {}): Promise<Webhook> {
    // Only what the server names, and only what was set.
    const body = { url: change.url, events: change.events, description: change.description, enabled: change.enabled };
    return reading(await this.#t.json({ method: "PATCH", path: ["webhooks", id], body, signal: options.signal }), readWebhook);
  }

  /** Removes an endpoint and all it was owed. */
  async delete(id: string, options: CallOptions = {}): Promise<void> {
    await this.#t.empty({ method: "DELETE", path: ["webhooks", id], signal: options.signal });
  }

  /** Sends the endpoint a signed webhook of type `webhook.test` now, and answers how it went. */
  async test(id: string, options: CallOptions = {}): Promise<WebhookTest> {
    const answer = await this.#t.json({ method: "POST", path: ["webhooks", id, "test"], signal: options.signal });
    return reading(answer, (v) => {
      const o = has(fields(v), "delivered");
      return present<WebhookTest>({ delivered: flag(o, "delivered"), status: count(o, "status") || undefined, failure: maybeText(o, "failure") });
    });
  }

  /**
   * Gives the endpoint a new signing secret and answers the endpoint with
   * it, the only time it is said. Until the `previousSecretUntil` it
   * answers (a day later, unless the server is set otherwise) the server
   * signs each webhook with the old secret as well, so a `Verifier` made
   * with either accepts it: change the application's secret within that
   * time. No `previousSecretUntil` means the old secret has already
   * stopped signing: put the new one in place at once.
   *
   * If the call fails with no answer (a `TransportError`), the secret may
   * have been changed and its new value lost. Call it again: that gives
   * another new secret, and the one the application holds goes on signing
   * for its own time meanwhile.
   */
  async rotateSecret(id: string, options: CallOptions = {}): Promise<Webhook> {
    return reading(await this.#t.json({ method: "POST", path: ["webhooks", id, "secret"], signal: options.signal }), readWebhook);
  }

  /**
   * Ends an endpoint's pause and answers the endpoint: what it is owed is
   * sent then, with what was given up while it was failing. One that is
   * not paused is answered as it is.
   */
  async resume(id: string, options: CallOptions = {}): Promise<Webhook> {
    return reading(await this.#t.json({ method: "POST", path: ["webhooks", id, "resume"], signal: options.signal }), readWebhook);
  }

  /** Answers one page of what an endpoint was sent, newest first. */
  async deliveries(id: string, q: DeliveryQuery = {}): Promise<Page<Delivery>> {
    const query = { ...paging(q.limit, q.after), state: q.state || undefined };
    const answer = await this.#t.json({ method: "GET", path: ["webhooks", id, "deliveries"], query, signal: q.signal });
    return reading(answer, (v) => readPage(v, readDelivery));
  }

  /**
   * Walks an endpoint's deliveries of one state (left out for all),
   * newest first, a page at a time. It ends at the first error, which it
   * throws.
   */
  allDeliveries(id: string, state?: string, options: CallOptions = {}): AsyncGenerator<Delivery, void, void> {
    return walk((after) => this.deliveries(id, { state, limit: largestPage, after, signal: options.signal }));
  }

  /** Has a webhook tried now: once more if it was given up, or without waiting for its next try if it is pending. */
  async retryDelivery(id: string, deliveryId: string, options: CallOptions = {}): Promise<void> {
    const answer = await this.#t.json({ method: "POST", path: ["webhooks", id, "deliveries", deliveryId, "retry"], signal: options.signal });
    reading(answer, (v) => named(v, "state"));
  }
}

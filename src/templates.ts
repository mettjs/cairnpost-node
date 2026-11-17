import { reading } from "./answer.ts";
import { fields, flag, has, list, maybeText, Misshapen, present, said, text, time } from "./read.ts";
import type { CallOptions, Transport } from "./transport.ts";

/**
 * Names a template to make an email from, and gives its variables their
 * values. A variable the template has a default for may be left out; one
 * it has none for must be given, and a value for a variable it does not
 * name is refused. A value is written as it is in the subject and the
 * text, and escaped in the HTML.
 */
export interface UseTemplate {
  name: string;
  variables?: Record<string, string> | undefined;
}

/** A variable a template names. */
export interface TemplateVariable {
  name: string;
  /** What it is filled with when a send gives it no value; undefined for one every send must give, and then `required` is true. */
  default?: string;
  required: boolean;
}

/**
 * An email written once to be sent many times: a subject and bodies that
 * name variables as `{{name}}`.
 */
export interface Template {
  id: string;
  /** How a send asks for it. */
  name: string;
  /** The sending domain it belongs to; undefined for one that serves every domain. */
  domain?: string;
  subject: string;
  /** `html` and `text` are left out in a list: `get` reads them. */
  html?: string;
  text?: string;
  variables: TemplateVariable[];
  createdAt: Date;
  updatedAt: Date;
}

/**
 * A template to keep. `name`, `subject`, and `html` or `text` are
 * required. `domain` is the sending domain it is for; left out, it is the
 * key's own domain, or serves every domain when the key is bound to none.
 * `defaults` are what a variable is filled with when a send gives it no
 * value.
 */
export interface NewTemplate {
  name: string;
  domain?: string | undefined;
  subject: string;
  html?: string | undefined;
  text?: string | undefined;
  defaults?: Record<string, string> | undefined;
}

/**
 * What to change about a template. A field left out is left as it is; a
 * field that is set is changed to exactly that, so `defaults: {}` leaves
 * no variable a default.
 */
export interface TemplateChange {
  name?: string | undefined;
  subject?: string | undefined;
  html?: string | undefined;
  text?: string | undefined;
  defaults?: Record<string, string> | undefined;
}

/**
 * A list of templates, each without its bodies. `more` says the server
 * has others than the list holds: ask for one sending domain's to see
 * them.
 */
export interface TemplateList {
  data: Template[];
  more: boolean;
}

function readTemplate(v: unknown): Template {
  const o = fields(v);
  return present<Template>({
    id: said(o, "id"),
    name: text(o, "name"),
    domain: maybeText(o, "domain"),
    subject: text(o, "subject"),
    html: maybeText(o, "html"),
    text: maybeText(o, "text"),
    variables: list(o, "variables", (item) => {
      const x = fields(item);
      const byDefault = x["default"];
      // An empty default is a default all the same.
      if (byDefault !== undefined && byDefault !== null && typeof byDefault !== "string") throw new Misshapen();
      return present<TemplateVariable>({ name: text(x, "name"), default: byDefault ?? undefined, required: flag(x, "required") });
    }),
    createdAt: time(o, "created_at"),
    updatedAt: time(o, "updated_at"),
  });
}

/** The templates emails are sent from. Every call needs an admin key. */
export class Templates {
  readonly #t: Transport;

  /** @internal */
  constructor(transport: Transport) {
    this.#t = transport;
  }

  /** Keeps a template. A `CairnPostError` with the code `name_taken` says its sending domain already has one of that name. */
  async create(n: NewTemplate, options: CallOptions = {}): Promise<Template> {
    const body = {
      name: n.name,
      domain: n.domain || undefined,
      subject: n.subject,
      html: n.html || undefined,
      text: n.text || undefined,
      defaults: n.defaults && Object.keys(n.defaults).length > 0 ? n.defaults : undefined,
    };
    return reading(await this.#t.json({ method: "POST", path: ["templates"], body, signal: options.signal }), readTemplate);
  }

  /**
   * Answers the templates the key manages, by sending domain and name:
   * its own domain's if it is bound to one; otherwise those of the domain
   * given, or all when it is left out.
   */
  async list(domain?: string, options: CallOptions = {}): Promise<TemplateList> {
    const query = { domain: domain || undefined };
    const answer = await this.#t.json({ method: "GET", path: ["templates"], query, signal: options.signal });
    // Whether there are more is said either way: left out, it must not
    // read as "these are all".
    return reading(answer, (v) => {
      const o = has(fields(v), "data", "more");
      return { data: list(o, "data", readTemplate), more: flag(o, "more") };
    });
  }

  /** Answers one template whole. `isNotFound` says there is none, or that it is another sending domain's. */
  async get(id: string, options: CallOptions = {}): Promise<Template> {
    return reading(await this.#t.json({ method: "GET", path: ["templates", id], signal: options.signal }), readTemplate);
  }

  /**
   * Changes a template and answers it as it now is. Emails asked for from
   * then on are made from it; one that already waits to be sent keeps
   * what it was filled with. A `CairnPostError` with the code
   * `changed_meanwhile` says others kept changing it at the same time:
   * read it and try again.
   */
  async update(id: string, change: TemplateChange, options: CallOptions = {}): Promise<Template> {
    // Only what the server names, and only what was set.
    const body = { name: change.name, subject: change.subject, html: change.html, text: change.text, defaults: change.defaults };
    return reading(await this.#t.json({ method: "PATCH", path: ["templates", id], body, signal: options.signal }), readTemplate);
  }

  /** Deletes a template: a send that names it is refused from then on. */
  async delete(id: string, options: CallOptions = {}): Promise<void> {
    await this.#t.empty({ method: "DELETE", path: ["templates", id], signal: options.signal });
  }
}

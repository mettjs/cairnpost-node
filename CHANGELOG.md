# Changelog

Every change a user of this client can notice is written here. The format is
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.2] - 2026-11-22

### Fixed

- `retryAfterMs` is read by one rule, the same in the Go and Python
  clients. A wait is 1 to 9 digits of seconds in the `Retry-After`
  header, or a date there exactly as HTTP writes one now
  (`Sun, 06 Nov 1994 08:49:37 GMT`), and is at least a second and at
  most 999,999,999 seconds. Anything else is no wait.
  - A date that never comes was read as a later one: 31 Feb as a day in
    March, an hour 24 as the next day. So was a date with its names in
    other letters (`sun`, `NOV`) or with the wrong day of the week.
  - The wait until a date is counted in whole seconds, a part of one as
    a whole one, so that a caller never comes back early. It was
    rounded to the nearest.
  - Around the header's value only a space, a tab or a line break is
    dropped. A no-break space was dropped too.
  - A date more than 999,999,999 seconds away (about 31 years) is no
    wait. It was passed on as it was.
  - On an email of a batch, a `retry_after` that is not a whole number
    from 1 to 999,999,999 is no wait. A fraction, or a number of any
    size, was passed on.

  A timer in Node.js holds at most 2,147,483,647 milliseconds, about
  24.8 days, and one given more fires at once. Sleep a longer
  `retryAfterMs` in parts.

## [0.1.1] - 2026-11-22

### Fixed

- `new Verifier` drops only a space, a tab or a line break around a
  signing secret, and so do the Go and Python clients now. Each dropped
  what its own language calls blank space, and the three sets differ: a
  secret with a byte order mark in front was taken here and refused by
  the other two. A secret with any other character around it, the mark,
  a no-break space or a form feed among them, is now refused with a
  `WebhookError` whose `reason` is `"secret"`. If yours is read from a
  file saved with a byte order mark, remove the mark.
- One value is now read the same way by this client and by the Go and
  Python ones. Around an API key, and around the id, the timestamp and
  the signatures of a webhook, a space, a tab or a line break is dropped
  and nothing else is.
  - `new CairnPost` refuses a key with any other character around it. It
    dropped a byte order mark and other blank characters (a no-break
    space, a form feed) and took what was left. If your key is read from
    a file saved with a byte order mark, remove the mark.
  - `verify` no longer drops those characters around a webhook's id,
    timestamp or signature, nor takes them for the gap between two
    signatures. Such a webhook is refused, as the other clients refuse
    it. A webhook as CairnPost sends it has none of them.

## [0.1.0] - 2026-11-17

### Added

- The client, for CairnPost 0.1.1: `new CairnPost(baseUrl, apiKey)`, with no
  dependencies, for Node.js 22 and later.
- `emails.send` and `emails.get`: send an email to one address or several
  (`to`, `cc`, `bcc`), with files (`attachments`), from a template
  (`template`) or at a later time (`scheduledAt`), and read what became of
  it at each address. An `idempotencyKey` makes a repeated send one email.
- `emails.sendBatch`: several emails in one request, each with its own
  result; `failed` counts those that did not go.
- `emails.cancel` and `emails.reschedule` for an email that waits, and
  `emails.file` to read back a file the server keeps.
- `CairnPostError`, with the server's `code` and `detail`, `retryable` and
  `retryAfterMs`; `TransportError` for a call that got no answer;
  `mayHaveSent`, `isNotFound` and `isWrongAddress` to ask what an error
  means. The client never retries by itself and follows no redirect.
- `Verifier`: checks a webhook's signature and timestamp and reads it,
  every type the server sends.
- With an admin key: `suppressions`, `webhooks` (with deliveries, a test,
  secret rotation and resume), `templates`, `received` (the emails that
  come in) and `captured`.
- `health` and `limits`.

[Unreleased]: https://github.com/mettjs/cairnpost-node/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/mettjs/cairnpost-node/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/mettjs/cairnpost-node/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/mettjs/cairnpost-node/releases/tag/v0.1.0

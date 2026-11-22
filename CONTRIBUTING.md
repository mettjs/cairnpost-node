# Contributing to cairnpost-node

This is the Node.js client for [CairnPost](https://github.com/mettjs/CairnPost),
a small gateway for transactional email. It does what the server's API
does, typed, and verifies the webhooks the server sends. It is small on
purpose.

## What it is not

- It does not retry by itself. It says what happened and whether trying
  again is right; the application decides.
- It has no dependencies at run time, and takes none. TypeScript and Node's
  type definitions are the only tools it is built with.
- It never puts an email's subject or body, or the API key, in an error.

## Setup and tests

Working on it needs Node.js 22.18 or later, which runs TypeScript as it is.

```sh
npm install
npm run check     # the types, of the source and the tests
npm test
npm run build     # what the package ships, into dist/
```

The integration tests run against a real CairnPost server. Start one with
the capture driver, so nothing is sent to anybody, and with
`CAIRNPOST_WEBHOOK_ALLOW_PRIVATE=on`, a `CAIRNPOST_CONTENT_RETENTION` and a
`CAIRNPOST_INBOUND_SECRET`, so that its webhooks can reach your machine and
what it keeps can be read back; make a send key and an admin key; then:

```sh
export CAIRNPOST_URL=http://localhost:8025
export CAIRNPOST_SEND_KEY=...
export CAIRNPOST_ADMIN_KEY=...
export CAIRNPOST_INBOUND_SECRET=...   # the server's own
npm run test:integration
```

Without those variables they fail rather than skip. CI runs all of the
above, the integration tests against the server's published image.

## Conventions

- **One file per part of the API**, small, with its tests in `test/`.
- **No dependencies at run time.** Node's own modules only.
- **TypeScript that Node runs as it is:** no enums, no parameter
  properties, imports with their `.ts` ending.
- **An answer is read field by field** (`src/read.ts`), never trusted to
  have its shape.
- **Errors say what to do**, and never echo the server's raw answer.
- **The shared cases are a copy.** `test/cases` holds the cases every
  CairnPost client is held to, copied from
  [`client-cases`](https://github.com/mettjs/CairnPost/tree/main/client-cases)
  in the server's repository at the commit `test/cases/SOURCE` names. A
  case is changed there, never here; a new call is added to the table in
  `test/asking.ts`. CI compares the copy with that commit.
- **Documentation is true now.** A change to what the client does updates
  the README and the changelog with it.
- **Commits** follow [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/),
  one concern each, and say why. Versions follow
  [Semantic Versioning](https://semver.org/spec/v2.0.0.html), and the
  changelog follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

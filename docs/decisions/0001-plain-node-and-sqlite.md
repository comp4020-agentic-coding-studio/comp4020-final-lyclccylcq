# 1. Plain Node with node:sqlite, no framework

Date: 2026-10-04 · Status: accepted (for crit 8; revisit at crit 9)

## Context

The starter fixes one `shared-cpu-1x` machine with 256 MB of memory and one volume
at `/data`, which is the only storage that survives a redeploy. It doesn't
prescribe a stack. Crit 8 needs a stranger to be able to do the core thing (walk
in, log a set) and find their trace when they come back. Crit 9 adds a real-time
floor. The starter's harness already pins Node 24 and pnpm through `mise.toml`.

## Options

- **Astro (the course default for the static half) with a Node adapter.** It's
  familiar from earlier crits, but the app is one page plus an API, so most of
  Astro would sit unused, and there would be a build step in the Dockerfile.
- **A framework server (Express, Fastify, Hono) with better-sqlite3 or an ORM.**
  These are well-trodden, but they add dependencies, and better-sqlite3 is a
  native module the slim image would have to compile.
- **Node's own `http` with `node:sqlite`.** No dependencies at all. TypeScript runs
  directly through Node 24's type stripping, so there is no build step either.
  The cost is hand-writing routing, static files and a small Markdown renderer
  for `/readme/`.

## Decision

Plain Node. Routing is a dozen lines, and the whole server fits in one file.
SQLite on the volume is the database the course setup supports, and having it in
Node removes a native dependency. The client is hand-written HTML, CSS and JS
served from `public/`.

## Consequences

- The image is `node:24-slim` plus source. Nothing is installed at build time.
- `node:sqlite` still prints an experimental warning on Node 24. It's suppressed
  in `CMD`, and its API could shift in a later Node.
- Only erasable TypeScript syntax is allowed (rule in `CLAUDE.md`).
- For crit 9, server-sent events need nothing beyond `http`. WebSockets would mean
  either a dependency or hand-rolling the protocol, which weighs towards SSE for
  updates going out plus the existing POSTs coming in. That's not decided yet.

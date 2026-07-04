# CivitasOne Suite — Development Guide

This guide takes you from a clean checkout to a running suite, teaches you how to add a
new service module the way the existing 33 services are built, and covers testing,
debugging, and the pitfalls that bite newcomers.

- **Runtime:** Node 20, pnpm workspaces + turbo.
- **Web:** Next.js 14.2 (`apps/web`).
- **Mobile:** Flutter 3.3+ (`apps/mobile`, Android today).
- **Data:** PostgreSQL 16, Redis 7, AWS SQS (LocalStack in dev), Keycloak 24.

---

## 1. Prerequisites

| Tool           | Version | Notes                                             |
|----------------|---------|---------------------------------------------------|
| Node.js        | 20.x    | Use the exact major; other majors are unsupported.|
| pnpm           | latest  | The monorepo is a pnpm workspace.                 |
| Docker + Compose | recent | Runs Postgres, Redis, Keycloak, LocalStack.     |
| Flutter        | 3.3+    | Only if you work on `apps/mobile`.                |
| psql / redis-cli | any   | Handy for inspecting state.                       |

---

## 2. Local setup, step by step

### 2.1 Install dependencies

```bash
pnpm install
```

This installs every workspace package (services, `apps/web`, shared `packages/*`) and
wires up the workspace symlinks. Run it from the repo root.

### 2.2 Start infrastructure

Bring up the backing services with docker-compose:

```bash
docker compose up -d   # Postgres 16, Redis 7, Keycloak 24, LocalStack (SQS)
```

Wait for Keycloak to become healthy (it is the slowest to boot). LocalStack provides an
SQS-compatible endpoint so you don't need real AWS in development.

### 2.3 Migrate databases (DB-per-service)

Each service owns its own database/schema and its own Drizzle migrations. Run migrations
per service before starting it:

```bash
# from a service directory, e.g. services/finance
pnpm run db:migrate
```

For a full bring-up, migrate every service (a root script / turbo task can fan this out).
If a service starts but 500s on the first query, an un-run migration is the usual cause.

### 2.4 Run services

Run an individual service in watch mode:

```bash
# services/finance
pnpm run dev
```

Or use turbo from the root to build/run across the workspace:

```bash
pnpm turbo run build        # build everything
pnpm turbo run dev          # run dev tasks (filter as needed)
pnpm turbo run dev --filter=finance --filter=gateway
```

### 2.5 Run the web app

```bash
# apps/web
pnpm run dev    # Next.js 14 dev server
```

Point it at the gateway (`:8080`) and Keycloak via the app's environment config.

### 2.6 Troubleshooting bring-up

| Symptom                                   | Likely cause / fix                                          |
|-------------------------------------------|-------------------------------------------------------------|
| 401 on every request                      | Keycloak not ready, or client/realm mismatch. Check JWKS.   |
| Service 500s on first query               | Migrations not run — `pnpm run db:migrate` for that service.|
| Commands accepted (202) but never applied | Consumer not running, or SQS/LocalStack unreachable.        |
| `ECONNREFUSED` to Postgres/Redis          | `docker compose up -d` not up, or wrong host/port in env.   |
| Port already in use                       | Another service instance running; free the port (see map).  |

---

## 3. Anatomy of a service module

Every service follows the same layout. Understanding these files is enough to read — and
extend — any of the 33 services.

```
services/<name>/
├── src/
│   ├── routes.ts       # HTTP layer: Fastify routes + zod request validation
│   ├── commands.ts     # publish commands (write side of CQRS)
│   ├── consumer.ts     # process commands, write via outbox
│   ├── repo.ts         # data access (Drizzle queries)
│   ├── schema.ts       # Drizzle table definitions
│   ├── topics.ts       # COMMANDS / EVENTS topic names
│   └── validators.ts   # shared zod schemas
└── shared/             # db client, request context, topic helpers
```

Responsibilities:

- **`routes.ts`** — the only HTTP surface. Validates input with zod, then either reads via
  `repo.ts` (returning data) or issues a command via `commands.ts` (returning `202`).
- **`commands.ts`** — serializes and publishes commands to SQS. No DB writes happen here.
- **`consumer.ts`** — subscribes to the command queue, applies the change through `repo.ts`,
  and writes events using the **outbox** pattern so state change + event emission are
  atomic and reliably relayed.
- **`repo.ts`** — all Drizzle queries. The rest of the code never touches SQL directly.
- **`schema.ts`** — Drizzle table/column definitions; the source for migrations.
- **`topics.ts`** — the `COMMANDS` and `EVENTS` string constants, so producers and
  consumers agree on names.
- **`validators.ts`** — reusable zod schemas shared by routes and consumers.

### 3.1 How to add a new module

1. **Scaffold the folder** under `services/<name>/` mirroring the layout above.
2. **Define tables** in `schema.ts` (Drizzle). Keep everything tenant-scoped.
3. **Generate + run migrations**: `pnpm run db:migrate`.
4. **Declare topics** in `topics.ts` — the `COMMANDS` and `EVENTS` your module owns.
5. **Write `validators.ts`** — zod schemas for each command payload and query.
6. **Write `repo.ts`** — Drizzle read/write functions. No business logic in SQL callers.
7. **Write `commands.ts`** — one publisher per command, targeting your command topic.
8. **Write `consumer.ts`** — a handler per command that mutates via `repo.ts` and emits
   events through the outbox.
9. **Write `routes.ts`** — reads call `repo.ts` and return data + pagination; writes call
   `commands.ts` and return `202 Accepted` with a `correlationId`.
10. **Register the service** in the gateway proxy map and assign it a port.
11. **Add tests** (see below) and make sure coverage clears the CI gate.

The golden rule: **reads go through `repo.ts` and return data; writes go through
`commands.ts` → SQS → `consumer.ts` and return `202`.** Never write to the DB from a route.

---

## 4. Testing

The suite uses a layered test strategy. All of it runs in CI behind a coverage gate.

### 4.1 Unit & integration — vitest

```bash
pnpm test                       # run vitest across the workspace (via turbo)
pnpm test --filter=finance      # a single service
pnpm vitest run src/repo.test.ts
pnpm vitest --coverage
```

- **Unit tests** cover pure logic (validators, mappers, command builders).
- **Integration tests** exercise routes/consumers against a real Postgres and an
  SQS-compatible endpoint (LocalStack).

### 4.2 Web E2E — Playwright

```bash
# apps/web
pnpm exec playwright test
pnpm exec playwright test --ui        # interactive
pnpm exec playwright test --headed
```

Drives the Next.js app end to end, including the Keycloak login flow.

### 4.3 Contract tests

Contract tests pin the request/response shapes between the gateway, services, and clients
so an internal refactor can't silently break the `/api/v1/...` contract. Run them before
changing any route signature.

### 4.4 Load tests — k6

```bash
k6 run load/finance-invoices.js
k6 run --vus 50 --duration 2m load/gateway-smoke.js
```

Use k6 to validate rate-limit behavior and latency under concurrency, especially after
touching the gateway or a hot read path.

### 4.5 Coverage gate

CI enforces coverage thresholds of **80% / 75% / 65%** (statements / branches / functions
tiers). A PR that drops below the gate fails. Add tests alongside code, not after.

---

## 5. Debugging

### 5.1 Logs — pino (structured JSON)

Services log JSON via **pino 8.21**. Each line carries the `correlationId`, so you can
follow a single command across route → command → consumer → event.

```bash
pnpm run dev | pnpm exec pino-pretty          # human-readable in dev
pnpm run dev 2>&1 | grep '"correlationId":"3f2b9c7e'   # trace one command
```

### 5.2 Database inspection — psql

```bash
psql "postgres://user:pass@localhost:5432/finance"
\dt                                   # list tables
SELECT id, status FROM invoices ORDER BY created_at DESC LIMIT 20;
SELECT * FROM outbox WHERE published_at IS NULL;   # stuck outbox rows
```

Unpublished `outbox` rows are the first thing to check when events aren't flowing.

### 5.3 Queue inspection — SQS / LocalStack

```bash
# list queues
aws --endpoint-url=http://localhost:4566 sqs list-queues

# peek at messages without deleting them
aws --endpoint-url=http://localhost:4566 sqs receive-message \
  --queue-url http://localhost:4566/000000000000/finance-commands \
  --max-number-of-messages 5 --visibility-timeout 0

# check queue depth
aws --endpoint-url=http://localhost:4566 sqs get-queue-attributes \
  --queue-url http://localhost:4566/000000000000/finance-commands \
  --attribute-names ApproximateNumberOfMessages
```

A growing queue depth with no processing means the consumer is down or erroring — check
its logs for the failing `correlationId`.

### 5.4 Redis

```bash
redis-cli ping
redis-cli keys 'ratelimit:*'          # inspect rate-limit counters
```

---

## 6. VS Code setup

Recommended extensions:

- **ESLint** and **Prettier** — enforce the shared lint/format config.
- **Prisma/Drizzle-friendly SQL tooling** — for reading `schema.ts` and running queries.
- **Vitest** extension — run/debug tests from the gutter.
- **Playwright Test for VSCode** — run E2E specs inline.
- **Dart** and **Flutter** — only if you touch `apps/mobile`.
- **Docker** — manage the compose stack.

Recommended workspace settings:

```jsonc
{
  "editor.formatOnSave": true,
  "editor.codeActionsOnSave": { "source.fixAll.eslint": "explicit" },
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "typescript.tsdk": "node_modules/typescript/lib"
}
```

Use the workspace TypeScript version (`typescript.tsdk`) so editor diagnostics match CI.

---

## 7. Common pitfalls

- **Writing to the DB from a route.** Writes must go through `commands.ts` → consumer.
  A synchronous DB write in `routes.ts` breaks the CQRS model and the outbox guarantees.
- **Forgetting migrations.** Each service has its own DB; `pnpm run db:migrate` per service.
- **Expecting read-after-write consistency.** Writes are async (`202`). Poll or subscribe.
- **Skipping tenant scoping.** Every query must be scoped to the caller's tenant. A missing
  filter is a data-leak bug, not just a correctness bug.
- **Hardcoding service ports in clients.** Go through the gateway (`:8080/api/v1/...`).
- **Ignoring the outbox.** If events aren't emitted, check for unpublished outbox rows
  before blaming SQS.
- **Not threading `correlationId`.** Without it, cross-service debugging is guesswork.
- **Mismatched TypeScript versions.** Use the workspace SDK so editor and CI agree.

---

## 8. The mental model

```mermaid
flowchart LR
    R[routes.ts<br/>zod + HTTP] -->|read| Repo[repo.ts<br/>Drizzle]
    R -->|write| Cmd[commands.ts]
    Cmd -->|publish| SQS[(SQS)]
    SQS --> Con[consumer.ts]
    Con -->|mutate| Repo
    Con -->|outbox| Evt[(EVENTS)]
    Repo --> DB[(Postgres 16)]
```

Keep each file to its job, keep every query tenant-scoped, and let the outbox — not
ad-hoc code — carry your events. That is the whole discipline.

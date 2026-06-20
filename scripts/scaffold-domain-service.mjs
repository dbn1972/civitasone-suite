#!/usr/bin/env node
/**
 * Scaffolds a minimal CQRS domain service from the crm-service pattern.
 * Usage: node scripts/scaffold-domain-service.mjs <config-json-file>
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function w(rel, content) {
  const p = join(ROOT, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content);
}

export function scaffold(cfg) {
  const {
    serviceName,
    packageName,
    port,
    pgSchema,
    table,
    resource,
    resourcePlural,
    routeBase,
    roles,
    dbRole,
    dbName,
    dbPassword,
    createBodyZod,
    viewExtraZod,
    viewExtraTs,
    viewExtraDrizzle,
    viewExtraSql,
    createDefault,
    commandTopic,
    eventTopic,
    serviceKey,
  } = cfg;

  const rolesArr = roles.map((r) => `"${r}"`).join(", ");
  const moduleDir = `services/${serviceName}/src/modules/${resourcePlural}`;

  w(`services/${serviceName}/package.json`, JSON.stringify({
    name: packageName,
    version: "0.1.0",
    type: "module",
    private: true,
    main: "./dist/index.js",
    scripts: {
      build: "tsc",
      dev: "tsx watch src/index.ts",
      worker: "tsx src/worker.ts",
      test: "vitest run",
      lint: "eslint src",
      typecheck: "tsc --noEmit",
      clean: "rm -rf dist",
    },
    dependencies: {
      "@civitasone/types": "workspace:*",
      "@civitasone/events": "workspace:*",
      "@civitasone/queue": "workspace:*",
      "@civitasone/cache": "workspace:*",
      "@civitasone/db": "workspace:*",
      "@civitasone/auth": "workspace:*",
      fastify: "^4.27.0",
      "@fastify/cors": "^9.0.0",
      pino: "^8.21.0",
      zod: "^3.23.0",
      "drizzle-orm": "^0.30.0",
      postgres: "^3.4.0",
      "@civitasone/schemas": "workspace:*",
      "@civitasone/observability": "workspace:*",
    },
    devDependencies: {
      typescript: "^5.4.0",
      tsx: "^4.16.0",
      vitest: "^2.0.0",
      "@types/node": "^20.0.0",
    },
  }, null, 2) + "\n");

  w(`services/${serviceName}/tsconfig.json`, `{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"]
}
`);

  w(`services/${serviceName}/vitest.config.ts`, `import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      JWT_ALGORITHM: "HS256",
      JWT_SECRET: "test_secret_for_civitasone_32chr",
      DATABASE_URL:
        process.env.DATABASE_URL ??
        "postgres://${dbRole}:${dbPassword}@localhost:5435/${dbName}",
      QUEUE_DRIVER: "memory",
      CACHE_DRIVER: "memory",
    },
  },
});
`);

  w(`services/${serviceName}/src/topics.ts`, `/** Topic + event names owned by ${serviceName}. {service}.{entity}.{action} */
export const COMMANDS = {
  create${cap(resource)}: "${commandTopic}",
} as const;

export const EVENTS = {
  ${resource}Created: "${eventTopic}",
} as const;

export const SERVICE = "${serviceKey}";
export const RESOURCE = "${resource}";
`);

  w(`services/${serviceName}/src/shared/context.ts`, readSharedContext());

  w(`services/${serviceName}/src/shared/outbox.ts`, readSharedOutbox());

  w(`services/${serviceName}/src/shared/infra.ts`, `/** Shared singletons: cache (Redis read-through) + queue (command/event bus). */
import { Cache } from "@civitasone/cache";
import { createQueue } from "@civitasone/queue";
import { SERVICE } from "../topics.js";

export const cache = new Cache({ service: SERVICE, defaultTtlSeconds: Number(process.env.CACHE_TTL ?? 60) });
export const queue = createQueue();
`);

  w(`services/${serviceName}/src/shared/db.ts`, `/**
 * ${serviceName} DB connection.
 * Connects with the ${dbRole} role to the ${dbName} database ONLY (L1).
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { createSqlClient } from "@civitasone/db";
import { schema as ${resourcePlural}Module } from "../modules/${resourcePlural}/schema.js";
import { outboxSchema } from "./outbox.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required (postgres://${dbRole}:***@host/${dbName})");

export const sqlClient = createSqlClient(url);

export const db = drizzle(sqlClient, {
  schema: { ...${resourcePlural}Module, ...outboxSchema },
});

export type Db = typeof db;
`);

  w(`${moduleDir}/schema.ts`, `/**
 * ${resourcePlural} module — Drizzle schema in Postgres schema \`${pgSchema}\`.
 */
import { pgSchema, uuid, varchar, integer, timestamp } from "drizzle-orm/pg-core";

export const domainSchema = pgSchema("${pgSchema}");

export const ${table} = domainSchema.table("${table}", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  name: varchar("name", { length: 200 }).notNull(),
${viewExtraDrizzle}
  status: varchar("status", { length: 24 }).notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type ${cap(resource)}Row = typeof ${table}.$inferSelect;
export type ${cap(resource)}Insert = typeof ${table}.$inferInsert;

export type ${cap(resource)}View = {
  id: string;
  tenantId: string;
  name: string;
${viewExtraTs}
  status: string;
  version: number;
};

export const schema = { ${table} };
`);

  w(`${moduleDir}/validators.ts`, `/** zod validators — applied at the route boundary. */
import { z } from "zod";
import { paginatedSchema } from "@civitasone/schemas/common";

export const create${cap(resource)}Body = z.object({
  ${createBodyZod}
});
export type Create${cap(resource)}Body = z.infer<typeof create${cap(resource)}Body>;

export const idParam = z.object({ id: z.string().uuid() });

export const ${resource}ViewSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  name: z.string(),
  ${viewExtraZod}
  status: z.string(),
  version: z.number().int(),
});

export const ${resourcePlural}ListSchema = paginatedSchema(${resource}ViewSchema);
`);

  w(`${moduleDir}/repo.ts`, readRepo(cfg));
  w(`${moduleDir}/commands.ts`, readCommands(cfg));
  w(`${moduleDir}/queries.ts`, readQueries(cfg));
  w(`${moduleDir}/consumer.ts`, readConsumer(cfg));
  w(`${moduleDir}/routes.ts`, readRoutes(cfg));

  w(`services/${serviceName}/src/app.ts`, `import Fastify, { type FastifyInstance } from "fastify";
import { registerOpsRoutes, dbPing } from "@civitasone/observability";
import { cache, queue } from "./shared/infra.js";
import { sqlClient } from "./shared/db.js";
import { registerSchemaErrorHandler } from "@civitasone/schemas/plugin";
import { HttpError } from "./shared/context.js";
import cors from "@fastify/cors";
import { authPlugin } from "@civitasone/auth/plugin";
import { randomUUID } from "node:crypto";
import { ${resource}Routes } from "./modules/${resourcePlural}/routes.js";

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info" },
    genReqId: (req) => (req.headers["x-correlation-id"] as string) ?? randomUUID(),
  });

  await app.register(cors, { origin: process.env.CORS_ORIGIN ?? false });
  await app.register(authPlugin);

  registerOpsRoutes(app, { service: "${serviceName}", checks: { db: { ping: () => dbPing(sqlClient) }, cache, queue } });

  await app.register(${resource}Routes);
  registerSchemaErrorHandler(app, HttpError);

  return app;
}
`);

  w(`services/${serviceName}/src/index.ts`, `/**
 * ${serviceName} HTTP entrypoint.
 * Run the consumer/relay separately: \`pnpm worker\` (src/worker.ts).
 */
import { buildApp } from "./app.js";

const port = Number(process.env.PORT ?? ${port});
const app = await buildApp();
await app.listen({ port, host: "0.0.0.0" });
app.log.info(\`${serviceName} (API) listening on :\${port}\`);
`);

  w(`services/${serviceName}/src/worker.ts`, `/**
 * ${serviceName} worker entrypoint — command consumers + outbox relay.
 */
import { pino } from "pino";
import { db, sqlClient } from "./shared/db.js";
import { queue } from "./shared/infra.js";
import { startRelay } from "./shared/outbox.js";
import { register${cap(resource)}Consumers } from "./modules/${resourcePlural}/consumer.js";

const log = pino({ name: "${serviceKey}-worker" });

register${cap(resource)}Consumers(queue);
await queue.start();
const relay = startRelay(db, queue);
log.info("${serviceName} worker: consumers + outbox relay running");

async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, "shutting down");
  clearInterval(relay);
  await queue.stop();
  await sqlClient.end();
  log.info("shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
`);

  w(`services/${serviceName}/migrations/0001_init.sql`, `-- ${serviceName} initial migration. Applied with ${dbRole} on ${dbName}.

CREATE TABLE IF NOT EXISTS ${pgSchema}.${table} (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  name         varchar(200) NOT NULL,
${viewExtraSql}
  status       varchar(24)  NOT NULL DEFAULT 'active',
  created_at   timestamptz  NOT NULL DEFAULT now(),
  updated_at   timestamptz  NOT NULL DEFAULT now(),
  created_by   uuid         NOT NULL,
  updated_by   uuid         NOT NULL,
  version      integer      NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_${table}_tenant ON ${pgSchema}.${table}(tenant_id);

CREATE TABLE IF NOT EXISTS _outbox.messages (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic          varchar(128) NOT NULL,
  event_type     varchar(128) NOT NULL,
  tenant_id      uuid NOT NULL,
  actor_id       uuid NOT NULL,
  correlation_id varchar(64) NOT NULL,
  payload        jsonb NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  published_at   timestamptz
);
CREATE INDEX IF NOT EXISTS idx_outbox_unpublished ON _outbox.messages(created_at) WHERE published_at IS NULL;

CREATE TABLE IF NOT EXISTS _inbox.processed (
  message_id   uuid PRIMARY KEY,
  processed_at timestamptz NOT NULL DEFAULT now()
);
`);

  w(`services/${serviceName}/tests/${serviceKey}.test.ts`, readTest(cfg));
}

function cap(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function readSharedContext() {
  return `/** Resolve RequestContext from the JWT + correlationId. */
import type { FastifyRequest } from "fastify";
import { verifyToken, toRequestContext, hasAnyRole } from "@civitasone/auth";
import type { RequestContext } from "@civitasone/types";

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export function resolveContext(req: FastifyRequest): RequestContext {
  const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    throw new HttpError(401, "UNAUTHENTICATED", "missing bearer token");
  }
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new HttpError(500, "CONFIG", "JWT_SECRET not set");
  try {
    const payload = verifyToken(auth.slice(7), secret);
    return toRequestContext(payload, correlationId);
  } catch {
    throw new HttpError(401, "UNAUTHENTICATED", "invalid or expired token");
  }
}

export function requireRole(ctx: RequestContext, roles: string[]): void {
  if (!hasAnyRole(ctx, roles)) {
    throw new HttpError(403, "FORBIDDEN", \`requires one of: \${roles.join(", ")}\`);
  }
}
`;
}

function readSharedOutbox() {
  return `/**
 * Transactional outbox — consumer writes business row + outbox row in SAME transaction.
 */
import { pgSchema, uuid, varchar, jsonb, timestamp } from "drizzle-orm/pg-core";
import { and, eq, isNull } from "drizzle-orm";
import type { Queue } from "@civitasone/queue";

export const outbox = pgSchema("_outbox");

export const outboxMessages = outbox.table("messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  topic: varchar("topic", { length: 128 }).notNull(),
  eventType: varchar("event_type", { length: 128 }).notNull(),
  tenantId: uuid("tenant_id").notNull(),
  actorId: uuid("actor_id").notNull(),
  correlationId: varchar("correlation_id", { length: 64 }).notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
});

export const processed = pgSchema("_inbox").table("processed", {
  messageId: uuid("message_id").primaryKey(),
  processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
});

export const outboxSchema = { outboxMessages, processed };

type Tx = { insert: (t: typeof outboxMessages) => { values: (v: unknown) => Promise<unknown> } };

export async function enqueue(
  tx: Tx,
  e: { topic: string; eventType: string; tenantId: string; actorId: string; correlationId: string; payload: Record<string, unknown> }
): Promise<void> {
  await tx.insert(outboxMessages).values(e);
}

export async function relayOnce(db: any, queue: Queue, batch = 100): Promise<number> {
  const rows = await db
    .select()
    .from(outboxMessages)
    .where(isNull(outboxMessages.publishedAt))
    .limit(batch);

  for (const row of rows) {
    await queue.publish(row.topic, {
      type: row.eventType,
      tenantId: row.tenantId,
      actorId: row.actorId,
      correlationId: row.correlationId,
      schemaVersion: "1.0",
      payload: row.payload,
    });
    await db.update(outboxMessages).set({ publishedAt: new Date() }).where(eq(outboxMessages.id, row.id));
  }
  return rows.length;
}

export function startRelay(db: any, queue: Queue, intervalMs = 500): NodeJS.Timeout {
  return setInterval(() => {
    relayOnce(db, queue).catch((err) => console.error({ err }, "outbox relay failed"));
  }, intervalMs);
}

export async function markProcessed(tx: any, messageId: string): Promise<boolean> {
  const existing = await tx.select().from(processed).where(eq(processed.messageId, messageId)).limit(1);
  if (existing.length) return false;
  await tx.insert(processed).values({ messageId });
  return true;
}

export { and, eq, isNull };
`;
}

function readRepo(cfg) {
  const { table, resource, resourcePlural, viewExtraTs, viewExtraAssign } = cfg;
  const Cap = cap(resource);
  return `/**
 * ${resourcePlural} repo — Drizzle queries against domain schema ONLY.
 */
import { eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { ${table}, type ${Cap}Row, type ${Cap}Insert, type ${Cap}View } from "./schema.js";

function toView(r: ${Cap}Row): ${Cap}View {
  return {
    id: r.id,
    tenantId: r.tenantId,
    name: r.name,
${viewExtraAssign}
    status: r.status,
    version: r.version,
  };
}

export async function findById(id: string, tenantId: string): Promise<${Cap}View | null> {
  const rows = await db.select().from(${table}).where(eq(${table}.id, id)).limit(1);
  const row = rows[0];
  if (!row || row.tenantId !== tenantId) return null;
  return toView(row);
}

export async function listByTenant(tenantId: string, limit: number, offset: number): Promise<${Cap}View[]> {
  const rows = await db.select().from(${table})
    .where(eq(${table}.tenantId, tenantId))
    .limit(limit)
    .offset(offset);
  return rows.map(toView);
}

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insert(tx: Writer, row: ${Cap}Insert): Promise<void> {
  await tx.insert(${table}).values(row);
}

export { toView };
`;
}

function readCommands(cfg) {
  const { resource, commandTopic, createDefault, viewExtraProjected } = cfg;
  const Cap = cap(resource);
  return `/**
 * Command handlers (WRITE PATH) — publish command, prime cache, return accepted.
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS, RESOURCE } from "../../topics.js";
import type { Create${Cap}Body } from "./validators.js";
import type { ${Cap}View } from "./schema.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function create${Cap}(ctx: RequestContext, body: Create${Cap}Body): Promise<Accepted> {
  const id = randomUUID();
  const projected: ${Cap}View = {
    id,
    tenantId: ctx.tenantId,
    name: body.name,
${viewExtraProjected}
    status: "active",
    version: 1,
  };

  await cache.put(cache.makeKey(ctx.tenantId, RESOURCE, id), projected);

  await queue.publish(COMMANDS.create${Cap}, {
    messageId: id,
    type: COMMANDS.create${Cap},
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: projected,
  });

  return { id, status: "accepted", correlationId: ctx.correlationId };
}
`;
}

function readQueries(cfg) {
  const { resource, resourcePlural } = cfg;
  const Cap = cap(resource);
  return `/**
 * Query handlers (READ PATH) — read-through cache.
 */
import { cache } from "../../shared/infra.js";
import { RESOURCE } from "../../topics.js";
import * as repo from "./repo.js";
import type { ${Cap}View } from "./schema.js";

export async function list${cap(resourcePlural)}(
  tenantId: string,
  limit: number,
  offset: number
): Promise<{ data: ${Cap}View[]; pagination: { hasMore: boolean; pageSize: number; cursor?: string } }> {
  return cache.listOrLoad(tenantId, RESOURCE, \`list:\${limit}:\${offset}\`, async () => {
    const rows = await repo.listByTenant(tenantId, limit, offset);
    return {
      data: rows,
      pagination: {
        hasMore: rows.length === limit,
        pageSize: limit,
        ...(rows.length ? { cursor: String(offset + rows.length) } : {}),
      },
    };
  });
}
`;
}

function readConsumer(cfg) {
  const { resource, resourcePlural, eventTopic, serviceKey, viewExtraInsert } = cfg;
  const Cap = cap(resource);
  return `/**
 * Consumer — the ONLY code that writes Postgres.
 */
import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS, RESOURCE } from "../../topics.js";
import * as repo from "./repo.js";
import type { ${Cap}View } from "./schema.js";

const AUDIT_TOPIC = "audit.event.record";

function keyFor(tenantId: string, id: string) {
  return cache.makeKey(tenantId, RESOURCE, id);
}

export function register${Cap}Consumers(queue: Queue): void {
  queue.subscribe<${Cap}View>(COMMANDS.create${Cap}, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;
      await repo.insert(tx, {
        id: p.id,
        tenantId: p.tenantId,
        name: p.name,
${viewExtraInsert}
        status: p.status,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
        version: 1,
      });
      await emit(tx, msg, EVENTS.${resource}Created, { ${resource}Id: p.id, name: p.name }, "create", p.id);
    });
    await cache.put(keyFor(msg.tenantId, msg.payload.id), msg.payload);
    await cache.invalidateResource(msg.tenantId, RESOURCE);
  });
}

async function emit(
  tx: unknown,
  msg: CommandEnvelope,
  eventType: string,
  payload: Record<string, unknown>,
  action: string,
  resourceId: string
): Promise<void> {
  const t = tx as Parameters<typeof enqueue>[0];
  await enqueue(t, {
    topic: eventType,
    eventType,
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload,
  });
  await enqueue(t, {
    topic: AUDIT_TOPIC,
    eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload: { service: "${serviceKey}", action, resourceType: "${resource}", resourceId, outcome: "success" },
  });
}
`;
}

function readRoutes(cfg) {
  const { resource, resourcePlural, routeBase, roles } = cfg;
  const Cap = cap(resource);
  const rolesArr = roles.map((r) => `"${r}"`).join(", ");
  return `/**
 * ${resourcePlural} HTTP routes.
 */
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { listQuerySchema, acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendValidated, sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { create${Cap}Body, ${resourcePlural}ListSchema } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const ROLES = [${rolesArr}];

export async function ${resource}Routes(app: FastifyInstance): Promise<void> {
  app.post("${routeBase}", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const body = create${Cap}Body.parse(req.body);
    sendAccepted(reply, acceptedResponseSchema, await commands.create${Cap}(ctx, body));
  });

  app.get("${routeBase}", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const q = listQuerySchema.parse(req.query);
    sendValidated(reply, ${resourcePlural}ListSchema, await queries.list${cap(resourcePlural)}(ctx.tenantId, q.limit, q.offset));
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({
        code: "VALIDATION_FAILED",
        message: "invalid request",
        correlationId,
        retryable: false,
        fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
`;
}

function readTest(cfg) {
  const { resource, resourcePlural, serviceKey, commandTopic } = cfg;
  const Cap = cap(resource);
  return `/**
 * ${cfg.serviceName} tests — CQRS wiring with MemoryQueue + MemoryCache.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { MemoryQueue } from "@civitasone/queue";
import { Cache, MemoryCache } from "@civitasone/cache";
import { create${Cap}Body } from "../src/modules/${resourcePlural}/validators.js";

describe("${resource} validators", () => {
  it("accepts minimal create body", () => {
    const body = create${Cap}Body.parse({ name: "Sample ${Cap}" });
    expect(body.name).toBe("Sample ${Cap}");
  });

  it("rejects empty name", () => {
    expect(() => create${Cap}Body.parse({ name: "" })).toThrow();
  });
});

describe("write-via-queue + read-via-cache", () => {
  let queue: MemoryQueue;
  let cache: Cache;
  const store = new Map<string, { id: string; name: string; tenantId: string; status: string }>();

  beforeEach(() => {
    queue = new MemoryQueue();
    cache = new Cache({ service: "${serviceKey}", store: new MemoryCache(), defaultTtlSeconds: 60 });
    store.clear();

    queue.subscribe<{ id: string; name: string; tenantId: string; status: string }>(
      "${commandTopic}",
      async (msg) => {
        store.set(msg.payload.id, {
          id: msg.payload.id,
          name: msg.payload.name,
          tenantId: msg.payload.tenantId,
          status: msg.payload.status,
        });
      }
    );
  });

  it("command primes cache before async DB write", async () => {
    const tenantId = "11111111-aaaa-4000-8000-000000000001";
    const id = "22222222-bbbb-4000-8000-000000000002";
    const projected = { id, tenantId, name: "Test ${Cap}", status: "active" };
    await cache.put(cache.makeKey(tenantId, "${resource}", id), projected);
    await queue.publish("${commandTopic}", {
      messageId: id,
      type: "${commandTopic}",
      tenantId,
      actorId: "00000000-aaaa-4000-8000-000000000001",
      correlationId: "c1",
      schemaVersion: "1.0",
      payload: projected,
    });

    expect(store.has(id)).toBe(false);
    const fromCache = await cache.getOrLoad(cache.makeKey(tenantId, "${resource}", id), async () => null);
    expect(fromCache).toEqual(projected);

    await new Promise((r) => setTimeout(r, 20));
    expect(store.get(id)?.name).toBe("Test ${Cap}");
  });

  it("listOrLoad caches paginated results", async () => {
    const tenantId = "11111111-aaaa-4000-8000-000000000003";
    const page = {
      data: [{ id: "c1", tenantId, name: "One", status: "active" }],
      pagination: { hasMore: false, pageSize: 50 },
    };
    let loads = 0;
    const first = await cache.listOrLoad(tenantId, "${resource}", "list:50:0", async () => {
      loads++;
      return page;
    });
    const second = await cache.listOrLoad(tenantId, "${resource}", "list:50:0", async () => {
      loads++;
      return page;
    });
    expect(first).toEqual(page);
    expect(second).toEqual(page);
    expect(loads).toBe(1);
  });
});
`;
}

const configs = [
  {
    serviceName: "report-service",
    packageName: "@civitasone/report-service",
    port: 3016,
    pgSchema: "reports",
    table: "jobs",
    resource: "job",
    resourcePlural: "jobs",
    routeBase: "/v1/reports/jobs",
    roles: ["report_user", "report_admin", "super_admin"],
    dbRole: "report_svc",
    dbName: "civitas_report",
    dbPassword: "report_dev_pw",
    createBodyZod: 'name: z.string().min(1).max(200),\n  reportType: z.string().min(1).max(64).optional(),',
    viewExtraZod: 'reportType: z.string().nullable(),',
    viewExtraTs: '  reportType: string | null;',
    viewExtraDrizzle: '  reportType: varchar("report_type", { length: 64 }),',
    viewExtraSql: '  report_type   varchar(64),',
    viewExtraAssign: '    reportType: r.reportType,',
    viewExtraProjected: '    reportType: body.reportType ?? null,',
    viewExtraInsert: '        reportType: p.reportType,',
    commandTopic: "reports.job.create",
    eventTopic: "reports.job.created",
    serviceKey: "reports",
  },
  {
    serviceName: "inventory-service",
    packageName: "@civitasone/inventory-service",
    port: 3025,
    pgSchema: "inventory",
    table: "items",
    resource: "item",
    resourcePlural: "items",
    routeBase: "/v1/inventory/items",
    roles: ["inventory_user", "inventory_admin", "super_admin"],
    dbRole: "inventory_svc",
    dbName: "civitas_inventory",
    dbPassword: "inventory_dev_pw",
    createBodyZod: 'name: z.string().min(1).max(200),\n  sku: z.string().min(1).max(64).optional(),',
    viewExtraZod: 'sku: z.string().nullable(),',
    viewExtraTs: '  sku: string | null;',
    viewExtraDrizzle: '  sku: varchar("sku", { length: 64 }),',
    viewExtraSql: '  sku           varchar(64),',
    viewExtraAssign: '    sku: r.sku,',
    viewExtraProjected: '    sku: body.sku ?? null,',
    viewExtraInsert: '        sku: p.sku,',
    commandTopic: "inventory.item.create",
    eventTopic: "inventory.item.created",
    serviceKey: "inventory",
  },
  {
    serviceName: "telephony-service",
    packageName: "@civitasone/telephony-service",
    port: 3026,
    pgSchema: "telephony",
    table: "calls",
    resource: "call",
    resourcePlural: "calls",
    routeBase: "/v1/telephony/calls",
    roles: ["telephony_user", "telephony_admin", "super_admin"],
    dbRole: "telephony_svc",
    dbName: "civitas_telephony",
    dbPassword: "telephony_dev_pw",
    createBodyZod: 'name: z.string().min(1).max(200),\n  callerNumber: z.string().min(3).max(32).optional(),',
    viewExtraZod: 'callerNumber: z.string().nullable(),',
    viewExtraTs: '  callerNumber: string | null;',
    viewExtraDrizzle: '  callerNumber: varchar("caller_number", { length: 32 }),',
    viewExtraSql: '  caller_number varchar(32),',
    viewExtraAssign: '    callerNumber: r.callerNumber,',
    viewExtraProjected: '    callerNumber: body.callerNumber ?? null,',
    viewExtraInsert: '        callerNumber: p.callerNumber,',
    commandTopic: "telephony.call.create",
    eventTopic: "telephony.call.created",
    serviceKey: "telephony",
  },
];

for (const cfg of configs) {
  scaffold(cfg);
  console.log(`scaffolded ${cfg.serviceName}`);
}

/**
 * estab-service — EST-LIBRARY (staff library catalogue + issues) test suite.
 *
 * The facilities/library module previously had ONLY create routes
 * (POST /v1/estab/library/books, POST /v1/estab/library/issues) with no way
 * to read the catalogue or loans back out. This suite proves the new read +
 * return surface:
 *   1. GET /v1/estab/library/books           — list (direct DB read, sync)
 *   2. GET /v1/estab/library/books/:id        — detail, 404 on unknown id
 *   3. PATCH /v1/estab/library/issues/:id/return — happy path (via consumer)
 *   4. PATCH .../return — idempotent (second return is a no-op)
 *   5. RLS — a tenant's library books are invisible to another tenant
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID, createHmac } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { MemoryQueue, type Queue, type Handler } from "@civitasone/queue";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { estabLibraryBooks, estabIssues } from "../src/modules/facilities/schema.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import { registerFacilitiesConsumers } from "../src/modules/facilities/consumer.js";
import { COMMANDS } from "../src/topics.js";

const JWT_SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

function mint(sub: string, roles: string[], tid: string): string {
  const n = Math.floor(Date.now() / 1000);
  const b = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const h = b({ alg: "HS256", typ: "JWT" });
  const p = b({
    sub, iss: "civitasone-dev", tid, tenantId: tid, sid: "t",
    email: "t@t.dev", name: "Test", roles, iat: n, exp: n + 3600,
  });
  const s = createHmac("sha256", JWT_SECRET).update(`${h}.${p}`).digest("base64url");
  return `${h}.${p}.${s}`;
}

function authHeaders(actor: string, roles: string[], tid: string): Record<string, string> {
  return { authorization: `Bearer ${mint(actor, roles, tid)}`, "x-tenant-id": tid };
}

// Test-harness fix (see estab.test.ts): a bare MemoryQueue does not
// auto-wrap handlers with withTenantConsumer the way the production
// createQueue() factory does — mirror that decoration here so consumer
// db.transaction() calls pick up the RLS tenant GUC.
function wireTenantAwareQueue(q: Queue): Queue {
  const rawSubscribe = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) =>
    rawSubscribe(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
  return q;
}

async function insertBook(
  tenantId: string, id: string, actor: string,
  copiesTotal: number, copiesAvailable: number, title = "Manual of Office Procedure",
): Promise<void> {
  await runWithTenant(tenantId, () =>
    db.transaction((tx) => tx.insert(estabLibraryBooks).values({
      id, tenantId, accessionNo: `ACC/${id.slice(0, 8)}`, title,
      author: "GoI", isbn: "978-0000000000", category: "reference",
      copiesTotal, copiesAvailable,
      createdBy: actor, updatedBy: actor,
    })),
  );
}

async function insertIssue(
  tenantId: string, id: string, bookId: string, actor: string,
  status: "issued" | "returned" = "issued",
): Promise<void> {
  await runWithTenant(tenantId, () =>
    db.transaction((tx) => tx.insert(estabIssues).values({
      id, tenantId, bookId, employeeRef: actor,
      dueAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      status,
      createdBy: actor, updatedBy: actor,
    })),
  );
}

const tenants: string[] = [];
function freshTenant(): string {
  const t = randomUUID();
  tenants.push(t);
  return t;
}

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  for (const tenantId of tenants) {
    await runWithTenant(tenantId, () =>
      db.transaction(async (tx) => {
        await tx.delete(estabIssues).where(inArray(estabIssues.tenantId, [tenantId]));
        await tx.delete(estabLibraryBooks).where(inArray(estabLibraryBooks.tenantId, [tenantId]));
        await tx.delete(outboxMessages).where(inArray(outboxMessages.tenantId, [tenantId]));
      }),
    );
  }
  await app.close();
  await sqlClient.end();
});

// ── 1. List books ────────────────────────────────────────────────────────

describe("GET /v1/estab/library/books", () => {
  it("lists books belonging to the caller's tenant", async () => {
    const T = freshTenant();
    const actor = randomUUID();
    const bookId = randomUUID();
    await insertBook(T, bookId, actor, 3, 2, "Right to Information Handbook");

    const res = await app.inject({
      method: "GET",
      url: "/v1/estab/library/books",
      headers: authHeaders(actor, ["estab_officer"], T),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
    const row = body.find((b: { id: string }) => b.id === bookId);
    expect(row).toBeDefined();
    expect(row.title).toBe("Right to Information Handbook");
    expect(row.copiesTotal).toBe(3);
    expect(row.copiesAvailable).toBe(2);
    expect(row.status).toBe("available");
  });

  it("without a token → 401", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/estab/library/books" });
    expect(res.statusCode).toBe(401);
  });
});

// ── 2. Book detail ───────────────────────────────────────────────────────

describe("GET /v1/estab/library/books/:id", () => {
  it("returns the book detail", async () => {
    const T = freshTenant();
    const actor = randomUUID();
    const bookId = randomUUID();
    await insertBook(T, bookId, actor, 1, 0, "Fundamental Rules");

    const res = await app.inject({
      method: "GET",
      url: `/v1/estab/library/books/${bookId}`,
      headers: authHeaders(actor, ["estab_officer"], T),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(bookId);
    expect(body.copiesAvailable).toBe(0);
    expect(body.status).toBe("unavailable");
  });

  it("unknown book id → 404 NOT_FOUND", async () => {
    const T = freshTenant();
    const actor = randomUUID();

    const res = await app.inject({
      method: "GET",
      url: `/v1/estab/library/books/${randomUUID()}`,
      headers: authHeaders(actor, ["estab_officer"], T),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("NOT_FOUND");
  });
});

// ── 3 & 4. Return — happy path + idempotency ────────────────────────────

describe("Library issue return — happy path and idempotency", () => {
  it("marks the issue returned and increments copiesAvailable exactly once", async () => {
    const T = freshTenant();
    const actor = randomUUID();
    const bookId = randomUUID();
    const issueId = randomUUID();
    await insertBook(T, bookId, actor, 2, 1);
    await insertIssue(T, issueId, bookId, actor, "issued");

    const q = wireTenantAwareQueue(new MemoryQueue());
    registerFacilitiesConsumers(q);
    await q.start();

    // First return — should mark returned + bump copiesAvailable 1 -> 2.
    await q.publish(COMMANDS.libraryReturn, {
      messageId: randomUUID(), type: COMMANDS.libraryReturn,
      tenantId: T, actorId: actor, correlationId: "corr-return-1", schemaVersion: "1.0",
      payload: { issueId, tenantId: T },
    });
    await new Promise<void>((r) => setTimeout(r, 500));

    // Second return of the same loan (e.g. a doubled client request, or the
    // PATCH being retried) — must be a no-op, not a double increment.
    await q.publish(COMMANDS.libraryReturn, {
      messageId: randomUUID(), type: COMMANDS.libraryReturn,
      tenantId: T, actorId: actor, correlationId: "corr-return-2", schemaVersion: "1.0",
      payload: { issueId, tenantId: T },
    });
    await new Promise<void>((r) => setTimeout(r, 500));
    await q.stop();

    const issues = await runWithTenant(T, () =>
      db.transaction((tx) => tx.select().from(estabIssues).where(eq(estabIssues.id, issueId))),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]?.status).toBe("returned");
    expect(issues[0]?.returnedAt).not.toBeNull();

    const books = await runWithTenant(T, () =>
      db.transaction((tx) => tx.select().from(estabLibraryBooks).where(eq(estabLibraryBooks.id, bookId))),
    );
    expect(books[0]?.copiesAvailable).toBe(2);
  });

  it("PATCH /v1/estab/library/issues/:id/return over HTTP → 202 accepted, unknown id → 404", async () => {
    const T = freshTenant();
    const actor = randomUUID();
    const bookId = randomUUID();
    const issueId = randomUUID();
    await insertBook(T, bookId, actor, 1, 0);
    await insertIssue(T, issueId, bookId, actor, "issued");

    const okRes = await app.inject({
      method: "PATCH",
      url: `/v1/estab/library/issues/${issueId}/return`,
      headers: authHeaders(actor, ["estab_officer"], T),
    });
    expect(okRes.statusCode).toBe(202);
    expect(okRes.json().status).toBe("accepted");

    const missingRes = await app.inject({
      method: "PATCH",
      url: `/v1/estab/library/issues/${randomUUID()}/return`,
      headers: authHeaders(actor, ["estab_officer"], T),
    });
    expect(missingRes.statusCode).toBe(404);
  });
});

// ── 5. RLS — cross-tenant isolation ─────────────────────────────────────

describe("Library books — RLS cross-tenant isolation", () => {
  it("tenant B cannot see tenant A's library books via list or detail", async () => {
    const tenantA = freshTenant();
    const tenantB = freshTenant();
    const actorA = randomUUID();
    const actorB = randomUUID();
    const bookIdA = randomUUID();
    await insertBook(tenantA, bookIdA, actorA, 1, 1, "Tenant A Confidential Register");

    const listRes = await app.inject({
      method: "GET",
      url: "/v1/estab/library/books",
      headers: authHeaders(actorB, ["estab_officer"], tenantB),
    });
    expect(listRes.statusCode).toBe(200);
    const rows = listRes.json();
    expect(rows.find((b: { id: string }) => b.id === bookIdA)).toBeUndefined();

    const detailRes = await app.inject({
      method: "GET",
      url: `/v1/estab/library/books/${bookIdA}`,
      headers: authHeaders(actorB, ["estab_officer"], tenantB),
    });
    expect(detailRes.statusCode).toBe(404);
  });
});

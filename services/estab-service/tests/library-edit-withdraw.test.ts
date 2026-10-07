/**
 * estab-service — GAP-ESTAB-LIBRARY-DETAIL-01
 * Edit + withdraw library books (catalogue correction + loan-integrity guards).
 *
 *   1. PATCH /books/:id            — edit title persists; copiesTotal increase
 *                                     raises copiesAvailable by the same delta
 *   2. PATCH /books/:id (409)      — cannot reduce copiesTotal below copies out
 *   3. PATCH /books/:id/withdraw   — withdraws when no copies out
 *   4. PATCH /books/:id/withdraw(409) — blocked while a copy is on loan
 *   5. withdrawn book is reported with status 'withdrawn'
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
import { outboxMessages } from "../src/shared/outbox.js";
import { registerFacilitiesConsumers } from "../src/modules/facilities/consumer.js";
import { COMMANDS } from "../src/topics.js";

const JWT_SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

function mint(sub: string, roles: string[], tid: string): string {
  const n = Math.floor(Date.now() / 1000);
  const b = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const h = b({ alg: "HS256", typ: "JWT" });
  const p = b({ sub, iss: "civitasone-dev", tid, tenantId: tid, sid: "t", email: "t@t.dev", name: "Test", roles, iat: n, exp: n + 3600 });
  const s = createHmac("sha256", JWT_SECRET).update(`${h}.${p}`).digest("base64url");
  return `${h}.${p}.${s}`;
}
function authHeaders(actor: string, roles: string[], tid: string): Record<string, string> {
  return { authorization: `Bearer ${mint(actor, roles, tid)}`, "x-tenant-id": tid };
}

function wireTenantAwareQueue(q: Queue): Queue {
  const rawSubscribe = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) =>
    rawSubscribe(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
  return q;
}

async function insertBook(tenantId: string, id: string, actor: string, copiesTotal: number, copiesAvailable: number, title = "Manual of Office Procedure"): Promise<void> {
  await runWithTenant(tenantId, () =>
    db.transaction((tx) => tx.insert(estabLibraryBooks).values({
      id, tenantId, accessionNo: `ACC/${id.slice(0, 8)}`, title,
      author: "GoI", isbn: "978-0000000000", category: "reference",
      copiesTotal, copiesAvailable, createdBy: actor, updatedBy: actor,
    })),
  );
}
async function insertIssue(tenantId: string, id: string, bookId: string, actor: string): Promise<void> {
  await runWithTenant(tenantId, () =>
    db.transaction((tx) => tx.insert(estabIssues).values({
      id, tenantId, bookId, employeeRef: actor,
      dueAt: new Date(Date.now() + 14 * 864e5), status: "issued",
      createdBy: actor, updatedBy: actor,
    })),
  );
}

const tenants: string[] = [];
function freshTenant(): string { const t = randomUUID(); tenants.push(t); return t; }

let app: FastifyInstance;
let q: Queue;

beforeAll(async () => {
  app = await buildApp();
  q = wireTenantAwareQueue(new MemoryQueue());
  registerFacilitiesConsumers(q);
  await q.start();
});
afterAll(async () => {
  await q.stop();
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

const settle = () => new Promise<void>((r) => setTimeout(r, 500));

describe("GAP-ESTAB-LIBRARY-DETAIL-01: edit a book", () => {
  it("PATCH title persists and copiesTotal increase bumps copiesAvailable", async () => {
    const T = freshTenant(); const actor = randomUUID(); const bookId = randomUUID();
    await insertBook(T, bookId, actor, 2, 1, "Old Title"); // 1 copy out

    // The HTTP route publishes to the app's production queue (no subscriber in
    // this test harness), so drive the consumer directly — exactly as
    // library.test.ts does for the return path.
    await q.publish(COMMANDS.libraryEdit, {
      messageId: randomUUID(), type: COMMANDS.libraryEdit,
      tenantId: T, actorId: actor, correlationId: "corr-edit-1", schemaVersion: "1.0",
      payload: { bookId, tenantId: T, title: "New Title", copiesTotal: 4 },
    });
    await settle();

    const rows = await runWithTenant(T, () =>
      db.transaction((tx) => tx.select().from(estabLibraryBooks).where(eq(estabLibraryBooks.id, bookId))));
    expect(rows[0]?.title).toBe("New Title");
    expect(rows[0]?.copiesTotal).toBe(4);
    // was 1 out, so available = 4 - 1 = 3
    expect(rows[0]?.copiesAvailable).toBe(3);
  });

  it("the PATCH route accepts a valid edit over HTTP → 202", async () => {
    const T = freshTenant(); const actor = randomUUID(); const bookId = randomUUID();
    await insertBook(T, bookId, actor, 2, 2);
    const res = await app.inject({
      method: "PATCH", url: `/v1/estab/library/books/${bookId}`,
      headers: authHeaders(actor, ["estab_officer"], T),
      payload: { title: "New Title" },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe("accepted");
  });

  it("rejects reducing copiesTotal below copies currently out → 409", async () => {
    const T = freshTenant(); const actor = randomUUID(); const bookId = randomUUID();
    await insertBook(T, bookId, actor, 3, 1); // 2 copies out

    const res = await app.inject({
      method: "PATCH", url: `/v1/estab/library/books/${bookId}`,
      headers: authHeaders(actor, ["estab_officer"], T),
      payload: { copiesTotal: 1 },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("COPIES_BELOW_OUT");
  });
});

describe("GAP-ESTAB-LIBRARY-DETAIL-01: withdraw a book", () => {
  it("withdraws when no copies are out and reports status 'withdrawn'", async () => {
    const T = freshTenant(); const actor = randomUUID(); const bookId = randomUUID();
    await insertBook(T, bookId, actor, 2, 2);

    await q.publish(COMMANDS.libraryWithdraw, {
      messageId: randomUUID(), type: COMMANDS.libraryWithdraw,
      tenantId: T, actorId: actor, correlationId: "corr-wd-1", schemaVersion: "1.0",
      payload: { bookId, tenantId: T, reason: "Damaged beyond repair" },
    });
    await settle();

    const detail = await app.inject({
      method: "GET", url: `/v1/estab/library/books/${bookId}`,
      headers: authHeaders(actor, ["estab_officer"], T),
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().status).toBe("withdrawn");
  });

  it("the withdraw route accepts over HTTP → 202", async () => {
    const T = freshTenant(); const actor = randomUUID(); const bookId = randomUUID();
    await insertBook(T, bookId, actor, 1, 1);
    const res = await app.inject({
      method: "PATCH", url: `/v1/estab/library/books/${bookId}/withdraw`,
      headers: authHeaders(actor, ["estab_officer"], T),
      payload: { reason: "Damaged beyond repair" },
    });
    expect(res.statusCode).toBe(202);
  });

  it("blocks withdraw while a copy is on loan → 409 COPIES_STILL_OUT", async () => {
    const T = freshTenant(); const actor = randomUUID(); const bookId = randomUUID(); const issueId = randomUUID();
    await insertBook(T, bookId, actor, 2, 1); // 1 copy out
    await insertIssue(T, issueId, bookId, actor);

    const res = await app.inject({
      method: "PATCH", url: `/v1/estab/library/books/${bookId}/withdraw`,
      headers: authHeaders(actor, ["estab_officer"], T),
      payload: { reason: "Trying to withdraw" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("COPIES_STILL_OUT");
  });

  it("non-estab role cannot edit → 403", async () => {
    const T = freshTenant(); const actor = randomUUID(); const bookId = randomUUID();
    await insertBook(T, bookId, actor, 1, 1);
    const res = await app.inject({
      method: "PATCH", url: `/v1/estab/library/books/${bookId}`,
      headers: authHeaders(actor, ["citizen"], T),
      payload: { title: "Hacked" },
    });
    expect(res.statusCode).toBe(403);
  });
});

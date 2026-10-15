/**
 * GAP-TENANT-ADMIN-BREAKGLASS-DETAIL-03 (real DB): opening a break-glass record
 * leaves a `breakglass.viewed` audit event naming the viewer and the grant, the
 * response carries no secret material, an unknown id is 404 with no audit row,
 * and a tenant_admin (not a platform role) is refused and leaves no audit row.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import type { FastifyInstance } from "fastify";
import { db, sqlClient } from "../src/shared/db.js";
import { adminBreakGlassLog } from "../src/modules/support/schema.js";
import { outboxMessages } from "../src/shared/outbox.js";

const { buildApp } = await import("../src/app.js");

const SECRET = process.env.JWT_SECRET as string;
const T = randomUUID();
const ACTOR = randomUUID();
const GRANT = randomUUID();
const bearer = (roles: string[]) => ({
  authorization: `Bearer ${signToken({ sub: ACTOR, roles, tid: T } as never, SECRET)}`,
});

async function viewedRows() {
  return runWithTenant(T, () =>
    db.transaction((tx) => tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, T))),
  ).then((rows) => rows.filter((r) => (r.payload as { action?: string }).action === "breakglass.viewed"));
}
async function cleanup() {
  await runWithTenant(T, () => db.transaction(async (tx) => {
    await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, T));
    await tx.delete(adminBreakGlassLog).where(eq(adminBreakGlassLog.tenantId, T));
  }));
}

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildApp();
  await cleanup();
  await runWithTenant(T, () => db.transaction((tx) => tx.insert(adminBreakGlassLog).values({
    id: GRANT, tenantId: T, ticketId: randomUUID(), actorId: ACTOR, reason: "production incident investigation",
    expiresAt: new Date(Date.now() + 3600_000), correlationId: randomUUID(), createdBy: ACTOR, updatedBy: ACTOR,
  })));
});
afterAll(async () => { await cleanup(); await app.close(); await sqlClient.end(); });

describe("break-glass detail view audit", () => {
  it("platform_admin view returns the record and writes one breakglass.viewed event", async () => {
    const r = await app.inject({ method: "GET", url: `/v1/admin/breakglass/${GRANT}?tenantId=${T}`, headers: bearer(["platform_admin"]) });
    expect(r.statusCode).toBe(200);
    const body = r.json() as Record<string, unknown>;
    expect(body.id).toBe(GRANT);
    expect(body.resourcesAccessed).toBeNull();
    expect(JSON.stringify(body)).not.toMatch(/secret|token|password|vault:/i);
    const rows = await viewedRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.actorId).toBe(ACTOR);
    expect((rows[0]!.payload as { resourceId: string }).resourceId).toBe(GRANT);
  });

  it("each view is audited (a second request adds a second event)", async () => {
    await app.inject({ method: "GET", url: `/v1/admin/breakglass/${GRANT}?tenantId=${T}`, headers: bearer(["platform_admin"]) });
    expect(await viewedRows()).toHaveLength(2);
  });

  it("unknown id is 404 and writes no event", async () => {
    const before = (await viewedRows()).length;
    const r = await app.inject({ method: "GET", url: `/v1/admin/breakglass/${randomUUID()}?tenantId=${T}`, headers: bearer(["platform_admin"]) });
    expect(r.statusCode).toBe(404);
    expect(await viewedRows()).toHaveLength(before);
  });

  it("tenant_admin is refused (403) and writes no event", async () => {
    const before = (await viewedRows()).length;
    const r = await app.inject({ method: "GET", url: `/v1/admin/breakglass/${GRANT}?tenantId=${T}`, headers: bearer(["tenant_admin"]) });
    expect(r.statusCode).toBe(403);
    expect(await viewedRows()).toHaveLength(before);
  });
});

/**
 * GAP-ADMIN-CONFIG-03: PATCH /v1/admin/platform-config (and the debug-mode
 * POST) must leave an audit.event.record in the outbox carrying the actor and
 * the before/after of the touched parameters, and a forbidden caller must
 * leave nothing behind. Real Postgres, real Fastify via app.inject().
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import type { FastifyInstance } from "fastify";
import { db, sqlClient } from "../src/shared/db.js";
import { outboxMessages } from "../src/shared/outbox.js";

const { buildApp } = await import("../src/app.js");

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const T = "5ad00000-0000-4000-8000-0000000000c1";
const ACTOR = "5ad0acc0-0000-4000-8000-0000000000c1";

function auth(roles: string[]): { authorization: string } {
  return { authorization: `Bearer ${signToken({ sub: ACTOR, tid: T, roles, sid: "sess-pc-audit" }, SECRET, 3600)}` };
}

async function auditRows() {
  return runWithTenant(T, () =>
    db.transaction((tx) => tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, T))),
  );
}
async function cleanup() {
  await runWithTenant(T, () => db.transaction((tx) => tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, T))));
}

let app: FastifyInstance;
beforeAll(async () => { app = await buildApp(); await cleanup(); });
afterAll(async () => { await cleanup(); await app.close(); await sqlClient.end(); });

describe("platform-config audit trail (GAP-ADMIN-CONFIG-03)", () => {
  it("PATCH by platform_admin emits an audit event with actor and before/after", async () => {
    const res = await app.inject({
      method: "PATCH", url: "/v1/admin/platform-config",
      headers: auth(["platform_admin"]),
      payload: { rateLimits: { perMinute: 321 } },
    });
    expect(res.statusCode).toBe(200);
    const rows = (await auditRows()).filter((r) => (r.payload as { action?: string }).action === "platform_config.update");
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.actorId).toBe(ACTOR);
    const payload = row.payload as { resourceType: string; before: { rateLimits: { perMinute: number } }; after: { rateLimits: { perMinute: number } } };
    expect(payload.resourceType).toBe("platform_config");
    expect(payload.after.rateLimits.perMinute).toBe(321);
    expect(typeof payload.before.rateLimits.perMinute).toBe("number");
    // `after` is the merged subtree (same shape as `before`), so burstMax is carried too.
    expect(typeof (payload.after.rateLimits as { burstMax?: number }).burstMax).toBe("number");
  });

  it("an out-of-bounds PATCH is rejected and writes no audit event", async () => {
    const before = (await auditRows()).length;
    const res = await app.inject({
      method: "PATCH", url: "/v1/admin/platform-config",
      headers: auth(["platform_admin"]),
      payload: { cacheTtl: { finance: 999999 } },
    });
    expect(res.statusCode).toBe(400);
    expect((await auditRows()).length).toBe(before);
  });

  it("a tenant_admin PATCH is forbidden and writes no audit event", async () => {
    const before = (await auditRows()).length;
    const res = await app.inject({
      method: "PATCH", url: "/v1/admin/platform-config",
      headers: auth(["tenant_admin"]),
      payload: { logLevel: "debug" },
    });
    expect(res.statusCode).toBe(403);
    expect((await auditRows()).length).toBe(before);
  });

  it("enabling debug mode is audited too", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/platform-config/debug-mode",
      headers: auth(["super_admin"]),
      payload: { durationMinutes: 5 },
    });
    expect(res.statusCode).toBe(200);
    const rows = (await auditRows()).filter((r) => (r.payload as { action?: string }).action === "platform_config.debug_mode");
    expect(rows).toHaveLength(1);
  });
});

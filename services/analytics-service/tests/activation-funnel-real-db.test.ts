/**
 * GAP-TENANT-ADMIN-ACTIVATION-05 (real DB, FORCE RLS, non-superuser service role):
 *  - an office's funnel is its own events only (never another tenant's)
 *  - recording the same step twice keeps the earliest occurrence
 *  - the PLATFORM funnel really spans every office for a platform admin (under RLS
 *    the request GUC is the caller's own tenant, so a plain scoped read returned only
 *    the caller's office) and stays platform-only (403 for tenant_admin)
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import type { FastifyInstance } from "fastify";
import { db, sqlClient } from "../src/shared/db.js";
import { factEvents } from "../src/modules/facts/schema.js";
import { buildApp } from "../src/app.js";

const SECRET = process.env.JWT_SECRET as string;
const A = randomUUID();
const B = randomUUID();
const ACTOR = randomUUID();
const bearer = (roles: string[], tid: string) => ({
  authorization: `Bearer ${signToken({ sub: ACTOR, roles, tid } as never, SECRET)}`,
  "content-type": "application/json",
  // The gateway derives x-tenant-id from the JWT; analytics' onRequest hook turns it
  // into the RLS GUC for the request.
  "x-tenant-id": tid,
});

async function cleanup() {
  for (const t of [A, B]) {
    await runWithTenant(t, () => db.transaction((tx) => tx.delete(factEvents).where(eq(factEvents.tenantId, t))));
  }
}

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildApp();
  await cleanup();
  for (const [tid, step] of [[A, "signin"], [A, "wizard_opened"], [B, "signin"]] as const) {
    const r = await app.inject({ method: "POST", url: "/v1/analytics/activation/events", headers: bearer(["tenant_admin"], tid), payload: { step } });
    expect(r.statusCode).toBe(202);
  }
});
afterAll(async () => { await cleanup(); await app.close(); await sqlClient.end(); });

describe("activation funnel (real DB, RLS)", () => {
  it("an office sees only its own events", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/analytics/activation/funnel", headers: bearer(["tenant_admin"], A) });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { tenantId: string; events: Array<{ step: string }> };
    expect(body.tenantId).toBe(A);
    expect(body.events.map((e) => e.step).sort()).toEqual(["signin", "wizard_opened"]);
  });

  it("recording a step twice keeps one (earliest) event", async () => {
    await app.inject({ method: "POST", url: "/v1/analytics/activation/events", headers: bearer(["tenant_admin"], A), payload: { step: "signin" } });
    const r = await app.inject({ method: "GET", url: "/v1/analytics/activation/funnel", headers: bearer(["tenant_admin"], A) });
    expect((r.json() as { events: unknown[] }).events).toHaveLength(2);
  });

  it("the platform funnel spans every office for a platform admin", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/analytics/activation/funnel/platform", headers: bearer(["platform_admin"], A) });
    expect(r.statusCode).toBe(200);
    const events = (r.json() as { events: Array<{ tenantId: string; step: string }> }).events;
    expect(new Set(events.filter((e) => [A, B].includes(e.tenantId)).map((e) => e.tenantId))).toEqual(new Set([A, B]));
  });

  it("the platform funnel is platform-only", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/analytics/activation/funnel/platform", headers: bearer(["tenant_admin"], A) });
    expect(r.statusCode).toBe(403);
  });
});

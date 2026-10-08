/**
 * GAP-SETUP-HOME-02 — the per-tenant setup-step deferral is persisted through
 * the generic tenant-settings store (settings.tenant_settings) under the key
 * `setup.skipped_steps`.
 *
 * This proves the "where to store the flag" that the previous pass said did not
 * exist actually does: PUT /v1/settings { key: "setup.skipped_steps", value:
 * [...] } is accepted (202), the settings consumer applies it to Postgres with
 * a mandatory audit event in the same transaction, GET /v1/settings/:key reads
 * it back, and the value round-trips as a JSON array of step keys. Also covers
 * the admin role gate and tenant isolation (RLS).
 *
 * Mirrors the catalogue/vigilance DB-backed tests: the settings consumer is
 * registered against a memory queue, wrapped with withTenantConsumer so the
 * tenant GUC is set before the FORCE-RLS write runs.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerSettingConsumers } from "../src/modules/settings/consumer.js";
import { tenantSettings } from "../src/modules/settings/schema.js";
import { outboxMessages } from "../src/shared/outbox.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const SETUP_SKIPPED_STEPS_KEY = "setup.skipped_steps";

const TENANT_A = randomUUID();
const TENANT_B = randomUUID();
const ADMIN = randomUUID();

function token(roles: string[], tenantId: string, actorId: string) {
  return signToken({ sub: actorId, tid: tenantId, roles, sid: "sess-skip" }, SECRET, 3600);
}
function hdr(tenantId: string, roles: string[], actorId = ADMIN) {
  return { authorization: `Bearer ${token(roles, tenantId, actorId)}`, "content-type": "application/json" };
}

async function waitFor<T>(fn: () => Promise<T | null | undefined>, ms = 4000): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("waitFor timeout");
}

let app: FastifyInstance;

beforeAll(async () => {
  // Register the settings consumer on the SHARED infra queue (QUEUE_DRIVER=memory
  // in tests), so the HTTP PUT's command is applied to Postgres during the test.
  // Mirror worker.ts: wrap subscribe with runWithTenant so the FORCE-RLS write
  // runs under the message's tenant GUC.
  {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const q = queue as any;
    const rawSubscribe = q.subscribe.bind(q);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    q.subscribe = (topic: string, handler: (msg: any) => Promise<void>) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      rawSubscribe(topic, (msg: any) => runWithTenant(msg.tenantId, () => handler(msg)));
  }
  registerSettingConsumers(queue);
  await queue.start();
  app = await buildApp();
});

afterAll(async () => {
  await runWithTenant(TENANT_A, () => db.transaction((tx) => tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT_A))));
  await app.close();
  await sqlClient.end();
});

describe("GAP-SETUP-HOME-02 setup.skipped_steps persistence (tenant settings)", () => {
  it("401 without a token, 403 for a bare employee (not admin)", async () => {
    const anon = await app.inject({
      method: "PUT", url: "/v1/settings",
      payload: { key: SETUP_SKIPPED_STEPS_KEY, value: ["leave-policies"] },
    });
    expect(anon.statusCode).toBe(401);

    const emp = await app.inject({
      method: "PUT", url: "/v1/settings",
      headers: hdr(TENANT_A, ["employee"]),
      payload: { key: SETUP_SKIPPED_STEPS_KEY, value: ["leave-policies"] },
    });
    expect(emp.statusCode).toBe(403);
  });

  it("PUT persists the skipped-step list (202) and it round-trips as a JSON array", async () => {
    const put = await app.inject({
      method: "PUT", url: "/v1/settings",
      headers: hdr(TENANT_A, ["tenant_admin"]),
      payload: { key: SETUP_SKIPPED_STEPS_KEY, value: ["finance-year-coa", "leave-policies"] },
    });
    expect(put.statusCode).toBe(202);

    // Durable row (authoritative): read under the tenant GUC so FORCE RLS admits it.
    const row = await waitFor(async () => {
      const rows = await runWithTenant(TENANT_A, () => db.transaction((tx) => tx.select().from(tenantSettings)
        .where(and(eq(tenantSettings.tenantId, TENANT_A), eq(tenantSettings.key, SETUP_SKIPPED_STEPS_KEY)))));
      return rows[0] ?? null;
    });
    expect(row.value).toEqual(["finance-year-coa", "leave-policies"]);

    // And the GET route surfaces the stored array to an admin caller.
    const g = await app.inject({
      method: "GET", url: `/v1/settings/${encodeURIComponent(SETUP_SKIPPED_STEPS_KEY)}`,
      headers: hdr(TENANT_A, ["tenant_admin"]),
    });
    expect(g.statusCode).toBe(200);
    expect(g.json().value).toEqual(["finance-year-coa", "leave-policies"]);
  });

  it("writes a mandatory audit event in the same transaction as the setting", async () => {
    const rows = await runWithTenant(TENANT_A, () => db.transaction((tx) => tx.select().from(outboxMessages)
      .where(and(eq(outboxMessages.tenantId, TENANT_A), eq(outboxMessages.topic, "audit.event.record")))));
    const audited = rows.some((r) => {
      const p = r.payload as { action?: string; resourceType?: string };
      return p.resourceType === "setting" && p.action === "upsert";
    });
    expect(audited).toBe(true);
  });

  it("updating the list overwrites it (un-skip a step)", async () => {
    const put = await app.inject({
      method: "PUT", url: "/v1/settings",
      headers: hdr(TENANT_A, ["tenant_admin"]),
      payload: { key: SETUP_SKIPPED_STEPS_KEY, value: ["finance-year-coa"] },
    });
    expect(put.statusCode).toBe(202);
    // Assert against the durable row (not the cache-first GET) to avoid read
    // caching masking the applied overwrite.
    const row = await waitFor(async () => {
      const rows = await runWithTenant(TENANT_A, () => db.transaction((tx) => tx.select().from(tenantSettings)
        .where(and(eq(tenantSettings.tenantId, TENANT_A), eq(tenantSettings.key, SETUP_SKIPPED_STEPS_KEY)))));
      const r = rows[0];
      return r && Array.isArray(r.value) && (r.value as string[]).length === 1 ? r : null;
    });
    expect(row.value).toEqual(["finance-year-coa"]);
  });

  it("tenant B (RLS) does not see tenant A's skipped-step row", async () => {
    const rows = await runWithTenant(TENANT_B, () => db.transaction((tx) => tx.select().from(tenantSettings)
      .where(and(eq(tenantSettings.tenantId, TENANT_B), eq(tenantSettings.key, SETUP_SKIPPED_STEPS_KEY)))));
    expect(rows).toHaveLength(0);
  });
});

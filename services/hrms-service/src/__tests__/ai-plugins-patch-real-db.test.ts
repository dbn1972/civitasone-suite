/**
 * AI-plugins PATCH — real-DB regression test.
 *
 * Covers two gap-ledger items on PATCH /v1/hrms/ai/plugins/:pluginId:
 *
 *  - GAP-TENANT-ADMIN-AI-PLUGINS-01 (first-PATCH 500): the INSERT branch (a
 *    plugin's first-ever config write) used to pass NULL for any optional
 *    field the caller omitted, violating the NOT NULL constraints on
 *    notify_on_prediction / auto_action / max_predictions_per_day (and mode /
 *    confidence_threshold), so a first PATCH of just {enabled:true} 500'd.
 *    The fix COALESCEs each VALUES slot to the column default. This test
 *    sends exactly {enabled:true} for a never-configured plugin and asserts
 *    200 + the row materialised with sane defaults (not NULL).
 *
 *  - GAP-TENANT-ADMIN-AI-PLUGINS-03 (role gate): the handler only called
 *    resolveContext (authn), so any authenticated tenant user could flip
 *    tenant-wide AI behaviour. The fix adds requireRole(tenant_admin/
 *    platform_admin/super_admin). This test proves an "employee" JWT gets 403
 *    and a "tenant_admin" JWT gets 200.
 *
 * Pattern mirrors medical-claims-real-db.test.ts: real buildApp() + app.inject()
 * against the real Postgres (DATABASE_URL from vitest.config.ts). hrms.ai_plugin_
 * configs is FORCE RLS, so verification reads go through withRawTenantGuc.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { withRawTenantGuc } from "@civitasone/db";
import { buildApp } from "../app.js";
import { sqlClient } from "../shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "cccccccc-0a1b-4000-8000-000000000a01";
const PLUGIN_ID = "attrition-prediction";

function tok(roles: string[], sub = "cccccccc-0a1b-4000-8000-0000000000f1") {
  return signToken({ sub, tid: TENANT, roles, sid: "sess-ai-plugins-test" }, SECRET);
}

let app: Awaited<ReturnType<typeof buildApp>>;

async function cleanup(): Promise<void> {
  await withRawTenantGuc(sqlClient, TENANT, (tx) =>
    tx`DELETE FROM hrms.ai_plugin_configs WHERE tenant_id = ${TENANT}`,
  );
}

beforeAll(async () => {
  app = await buildApp();
  await cleanup();
});
afterAll(async () => {
  await cleanup();
  await app.close();
  await sqlClient.end();
});

describe("PATCH /v1/hrms/ai/plugins/:pluginId — role gate (GAP-TENANT-ADMIN-AI-PLUGINS-03)", () => {
  it("403 — a plain 'employee' cannot change a tenant-wide AI plugin config", async () => {
    const r = await app.inject({
      method: "PATCH",
      url: `/v1/hrms/ai/plugins/${PLUGIN_ID}`,
      headers: { authorization: `Bearer ${tok(["employee"])}`, "content-type": "application/json" },
      payload: { enabled: true },
    });
    expect(r.statusCode).toBe(403);
    expect(r.json<{ code: string }>().code).toBe("FORBIDDEN");
  });

  it("403 — a non-admin HR role (hr_officer) is also rejected", async () => {
    const r = await app.inject({
      method: "PATCH",
      url: `/v1/hrms/ai/plugins/${PLUGIN_ID}`,
      headers: { authorization: `Bearer ${tok(["hr_officer"])}`, "content-type": "application/json" },
      payload: { enabled: true },
    });
    expect(r.statusCode).toBe(403);
  });
});

describe("PATCH /v1/hrms/ai/plugins/:pluginId — first-ever PATCH (GAP-TENANT-ADMIN-AI-PLUGINS-01)", () => {
  it("200 — first PATCH of {enabled:true} for a never-configured plugin does not 500, and defaults the NOT NULL columns", async () => {
    const r = await app.inject({
      method: "PATCH",
      url: `/v1/hrms/ai/plugins/${PLUGIN_ID}`,
      headers: { authorization: `Bearer ${tok(["tenant_admin"])}`, "content-type": "application/json" },
      payload: { enabled: true },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json<{ status: string }>().status).toBe("updated");

    const rows = await withRawTenantGuc(sqlClient, TENANT, (tx) =>
      tx`SELECT enabled, mode, confidence_threshold, notify_on_prediction,
                auto_action, max_predictions_per_day
         FROM hrms.ai_plugin_configs
         WHERE tenant_id = ${TENANT} AND plugin_id = ${PLUGIN_ID}`,
    );
    expect(rows.length).toBe(1);
    const row = rows[0] as Record<string, unknown>;
    expect(row.enabled).toBe(true);
    // attrition-prediction's defaultThreshold is 50 (ML_PLUGINS registry).
    expect(Number(row.confidence_threshold)).toBe(50);
    expect(row.mode).toBe("disabled");
    expect(row.notify_on_prediction).toBe(false);
    expect(row.auto_action).toBe(false);
    expect(Number(row.max_predictions_per_day)).toBe(1000);
  });

  it("200 — a later partial PATCH only changes the field supplied (ON CONFLICT path)", async () => {
    const r = await app.inject({
      method: "PATCH",
      url: `/v1/hrms/ai/plugins/${PLUGIN_ID}`,
      headers: { authorization: `Bearer ${tok(["tenant_admin"])}`, "content-type": "application/json" },
      payload: { mode: "shadow" },
    });
    expect(r.statusCode).toBe(200);

    const rows = await withRawTenantGuc(sqlClient, TENANT, (tx) =>
      tx`SELECT enabled, mode FROM hrms.ai_plugin_configs
         WHERE tenant_id = ${TENANT} AND plugin_id = ${PLUGIN_ID}`,
    );
    const row = rows[0] as Record<string, unknown>;
    // mode changed, enabled (set true earlier) preserved — not reset to the default.
    expect(row.mode).toBe("shadow");
    expect(row.enabled).toBe(true);
  });
});

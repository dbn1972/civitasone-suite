/**
 * GAP-TENANT-ADMIN-AI-PLUGINS-01 (real DB): PATCH /v1/hrms/ai/plugins/:pluginId
 *  - first-ever PATCH with only {enabled:true} returns 200 (no NOT NULL 500)
 *  - the write leaves an audit row (actor, plugin, reason, before -> after)
 *    written in the same tenant-scoped transaction
 *  - a non-admin is refused and leaves no audit row
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { withRawTenantGuc } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET as string;
const TENANT = randomUUID();
const OTHER = randomUUID();
const ACTOR = randomUUID();
const ACTION = "ai_plugin_config_update";

function auth(tid: string, roles: string[]): { authorization: string } {
  const jwt = signToken({ sub: ACTOR, tid, roles, sid: "sess-plugin-audit" }, SECRET, 3600);
  return { authorization: `Bearer ${jwt}` };
}

let app: FastifyInstance;
beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app.close(); await sqlClient.end(); });

async function auditRows(tid: string) {
  return withRawTenantGuc(sqlClient, tid, (tx) => tx`
    SELECT actor_id, payload FROM employee.hrms_audit_log
    WHERE tenant_id = ${tid} AND action = ${ACTION} ORDER BY created_at ASC`);
}

describe("AI-PLUGINS-01: plugin config PATCH audit", () => {
  it("first-ever PATCH {enabled:true} returns 200 and writes a before/after audit row", async () => {
    const r = await app.inject({
      method: "PATCH", url: "/v1/hrms/ai/plugins/nlu-chatbot",
      headers: auth(TENANT, ["tenant_admin"]), payload: { enabled: true },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().config).toEqual({ enabled: true });

    const rows = await auditRows(TENANT);
    expect(rows.length).toBe(1);
    expect(rows[0]!.actor_id).toBe(ACTOR);
    const p = rows[0]!.payload as { pluginId: string; before: unknown; after: { enabled: boolean } };
    expect(p.pluginId).toBe("nlu-chatbot");
    expect(p.before).toBeNull();
    expect(p.after.enabled).toBe(true);
  });

  it("a later PATCH records the prior state as before, and the reason is audited but not echoed", async () => {
    const r = await app.inject({
      method: "PATCH", url: "/v1/hrms/ai/plugins/nlu-chatbot",
      headers: auth(TENANT, ["tenant_admin"]), payload: { mode: "shadow", reason: "pilot with HR desk" },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().config).toEqual({ mode: "shadow" });
    const rows = await auditRows(TENANT);
    expect(rows.length).toBe(2);
    const p = rows[1]!.payload as { reason: string; before: { mode: string }; after: { mode: string } };
    expect(p.reason).toBe("pilot with HR desk");
    expect(p.before.mode).toBe("disabled");
    expect(p.after.mode).toBe("shadow");
  });

  it("a non-admin is rejected (403) and leaves no audit row", async () => {
    const r = await app.inject({
      method: "PATCH", url: "/v1/hrms/ai/plugins/nlu-chatbot",
      headers: auth(OTHER, ["employee"]), payload: { enabled: true },
    });
    expect(r.statusCode).toBe(403);
    expect((await auditRows(OTHER)).length).toBe(0);
  });

  it("an out-of-range threshold is a 400 and leaves no audit row", async () => {
    const r = await app.inject({
      method: "PATCH", url: "/v1/hrms/ai/plugins/nlu-chatbot",
      headers: auth(OTHER, ["tenant_admin"]), payload: { confidenceThreshold: 101 },
    });
    expect(r.statusCode).toBe(400);
    expect((await auditRows(OTHER)).length).toBe(0);
  });
});

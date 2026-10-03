/** GAP-ADMIN-INTEGRATIONS-04: pending/history rows carry resolved actor names, never ids alone. */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";

process.env.CONFIG_ENC_KEY = process.env.CONFIG_ENC_KEY ?? "test_config_enc_key_for_civitasone_32c"; // gitleaks:allow
const { buildApp } = await import("../src/app.js");
const { sqlClient } = await import("../src/shared/db.js");
const { queue } = await import("../src/shared/infra.js");
const { tenantScoped } = await import("../src/shared/tenant-queue.js");
const { registerF3_integration_settings_Consumers } = await import("../src/modules/integration-settings/f3-consumer.js");
const { fetchUserNames } = await import("../src/shared/identity-names.js");

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const PROPOSER = "5e7a0000-0000-4000-8000-000000000001";
const APPROVER = "5e7a0000-0000-4000-8000-000000000002";
const STRANGER = "5e7a0000-0000-4000-8000-000000000003";
const auth = (actor: string) => ({ authorization: `Bearer ${signToken({ sub: actor, tid: TENANT, roles: ["tenant_admin"], sid: "sess-names" }, SECRET, 3600)}` });

let app: FastifyInstance;
const realFetch = globalThis.fetch;
beforeAll(async () => {
  registerF3_integration_settings_Consumers(tenantScoped(queue));
  await queue.start();
  app = await buildApp();
});
afterAll(async () => { globalThis.fetch = realFetch; await app.close(); await queue.stop(); await sqlClient.end(); });

function stubIdentity(rows: Array<{ id: string; name: string }> | "down") {
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = String(input);
    if (!url.includes("/identity/internal/user-summaries")) return realFetch(input, init);
    // The lookup must be tenant-scoped and use the internal-elevation headers.
    const h = (init?.headers ?? {}) as Record<string, string>;
    expect(h["x-tenant-id"]).toBe(TENANT);
    expect(h["x-internal"]).toBe("1");
    if (rows === "down") throw new Error("identity unreachable");
    return new Response(JSON.stringify(rows), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

describe("integration actor names", () => {
  it("shows proposer and approver names on the pending change and the history, and never a bare id", async () => {
    stubIdentity([{ id: PROPOSER, name: "A. Rao" }, { id: APPROVER, name: "S. Iyer" }, { id: STRANGER, name: "Not In This List" }]);
    const put = await app.inject({ method: "PUT", url: "/v1/admin/integrations/ai_anthropic/dev", headers: auth(PROPOSER), payload: { config: { apiKey: "sk-ant-SECRETKEY123", model: "claude-3-5-sonnet-latest" } } });
    expect(put.statusCode).toBe(202);
    await (queue as any).drain?.();
    const pending = (await app.inject({ method: "GET", url: "/v1/admin/integrations/ai_anthropic/dev", headers: auth(APPROVER) })).json();
    expect(pending.pendingChange.proposedByName).toBe("A. Rao");
    expect(pending.pendingChange.approvedByName).toBeNull();

    const ok = await app.inject({ method: "POST", url: "/v1/admin/integrations/ai_anthropic/dev/approve", headers: auth(APPROVER), payload: {} });
    expect(ok.statusCode).toBeLessThan(300);
    await (queue as any).drain?.();
    const after = (await app.inject({ method: "GET", url: "/v1/admin/integrations/ai_anthropic/dev", headers: auth(APPROVER) })).json();
    expect(after.history[0]).toMatchObject({ proposedByName: "A. Rao", approvedByName: "S. Iyer", status: "approved" });
  });

  it("degrades to null names (not an error) when identity-service is down or does not know the id", async () => {
    stubIdentity("down");
    const res = await app.inject({ method: "GET", url: "/v1/admin/integrations/ai_anthropic/dev", headers: auth(APPROVER) });
    expect(res.statusCode).toBe(200);
    expect(res.json().history[0]).toMatchObject({ proposedByName: null, approvedByName: null });
    stubIdentity([]);
    expect((await app.inject({ method: "GET", url: "/v1/admin/integrations/ai_anthropic/dev", headers: auth(APPROVER) })).json().history[0].proposedByName).toBeNull();
  });

  it("only resolves the ids that were asked for (no directory leak) and skips the call for none", async () => {
    stubIdentity([{ id: PROPOSER, name: "A. Rao" }, { id: STRANGER, name: "Someone Else" }]);
    const names = await fetchUserNames(TENANT, [PROPOSER]);
    expect([...names.keys()]).toEqual([PROPOSER]);
    const spy = vi.fn();
    globalThis.fetch = spy as unknown as typeof fetch;
    expect((await fetchUserNames(TENANT, [])).size).toBe(0);
    expect(spy).not.toHaveBeenCalled();
  });
});

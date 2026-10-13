/**
 * w0-report (F5) defect 2: POST /v1/admin/idp/providers/export-audit did not
 * exist (the web IdpTable called it, so exports were never audited). Real app
 * + real auth; only the queue publish is observed.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { COMMANDS } from "../src/topics.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-0002-4000-8000-0000000000f5";
const ACTOR = "bbbbbbbb-0002-4000-8000-0000000000f5";
const tok = (roles: string[]) => signToken({ sub: ACTOR, tid: TENANT, roles, sid: "s" }, SECRET);
const URL = "/v1/admin/idp/providers/export-audit";

describe("POST /v1/admin/idp/providers/export-audit", () => {
  let app: FastifyInstance;
  let publish: ReturnType<typeof vi.spyOn>;
  beforeAll(async () => { app = await buildApp(); });
  afterAll(async () => { await app.close(); await sqlClient.end(); });
  afterEach(() => publish?.mockRestore());
  const post = (roles: string[] | null, payload?: unknown) => {
    publish = vi.spyOn(queue, "publish").mockResolvedValue(undefined as never);
    return app.inject({ method: "POST", url: URL, headers: roles ? { authorization: `Bearer ${tok(roles)}` } : {}, ...(payload !== undefined ? { payload: payload as never } : {}) });
  };
  const exportCalls = () => publish.mock.calls.filter((c) => c[0] === COMMANDS.idpExportRecorded);

  it("202 for a tenant admin; publishes the audit command carrying actor, tenant, rowCount, filtered and a timestamp", async () => {
    const r = await post(["tenant_admin"], { rowCount: 4, filter: "keycloak" });
    expect(r.statusCode).toBe(202);
    expect(r.json()).toMatchObject({ status: "accepted" });
    expect(exportCalls()).toHaveLength(1);
    const env = exportCalls()[0]![1] as { tenantId: string; actorId: string; payload: Record<string, unknown> };
    expect(env).toMatchObject({ tenantId: TENANT, actorId: ACTOR });
    expect(env.payload).toMatchObject({ rowCount: 4, filtered: true });
    expect(typeof env.payload.exportedAt).toBe("string");
  });

  it("a null / absent filter is recorded as unfiltered", async () => {
    expect((await post(["tenant_admin"], { rowCount: 2, filter: null })).statusCode).toBe(202);
    expect((exportCalls()[0]![1] as { payload: Record<string, unknown> }).payload).toMatchObject({ filtered: false });
  });

  it("401 without auth and 403 for a non-admin role; nothing is published", async () => {
    expect((await post(null, { rowCount: 1 })).statusCode).toBe(401);
    expect(exportCalls()).toHaveLength(0);
    expect((await post(["viewer"], { rowCount: 1 })).statusCode).toBe(403);
    expect(exportCalls()).toHaveLength(0);
  });

  it("400 for an invalid body; nothing is published", async () => {
    for (const bad of [{ rowCount: -1 }, { rowCount: "x" }, {}, { rowCount: 10001 }]) {
      expect((await post(["tenant_admin"], bad)).statusCode).toBe(400);
    }
    expect(exportCalls()).toHaveLength(0);
  });
});

/**
 * W1 SF-08: generic POST /v1/admin/table-exports/audit (any authenticated user). Real app
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
const URL = "/v1/admin/table-exports/audit";

describe("POST /v1/admin/table-exports/audit", () => {
  let app: FastifyInstance;
  let publish: ReturnType<typeof vi.spyOn>;
  beforeAll(async () => { app = await buildApp(); });
  afterAll(async () => { await app.close(); await sqlClient.end(); });
  afterEach(() => publish?.mockRestore());
  const post = (roles: string[] | null, payload?: unknown) => {
    publish = vi.spyOn(queue, "publish").mockResolvedValue(undefined as never);
    return app.inject({ method: "POST", url: URL, headers: roles ? { authorization: `Bearer ${tok(roles)}` } : {}, ...(payload !== undefined ? { payload: payload as never } : {}) });
  };
  const exportCalls = () => publish.mock.calls.filter((c) => c[0] === COMMANDS.tableExportRecorded);

  it("202 for any authenticated role; publishes the audit command carrying actor, tenant, resource, rowCount, filtered and a timestamp", async () => {
    for (const role of ["tenant_admin", "viewer", "finance_officer"]) {
      const r = await post([role], { resource: "finance/treasury/cheques", rowCount: 4, filtered: true });
      expect(r.statusCode).toBe(202);
      expect(r.json()).toMatchObject({ status: "accepted" });
      const env = exportCalls().at(-1)![1] as { tenantId: string; actorId: string; payload: Record<string, unknown> };
      expect(env).toMatchObject({ tenantId: TENANT, actorId: ACTOR });
      expect(env.payload).toMatchObject({ resource: "finance/treasury/cheques", rowCount: 4, filtered: true });
      expect(typeof env.payload.exportedAt).toBe("string");
      publish.mockClear();
    }
  });

  it("401 without auth; nothing is published", async () => {
    expect((await post(null, { resource: "a/b", rowCount: 1 })).statusCode).toBe(401);
    expect(exportCalls()).toHaveLength(0);
  });

  it("400 for an invalid body; nothing is published", async () => {
    for (const bad of [{ resource: "a/b", rowCount: -1 }, { resource: "a/b", rowCount: "x" }, {}, { resource: "a/b", rowCount: 100001 }, { rowCount: 1 }, { resource: "../etc/passwd", rowCount: 1 }, { resource: "A B", rowCount: 1 }]) {
      expect((await post(["viewer"], bad)).statusCode).toBe(400);
    }
    expect(exportCalls()).toHaveLength(0);
  });
});

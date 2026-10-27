/**
 * OWNER DECISION F7: the data-export module dropdown lists only modules that can
 * actually be exported (those with a registered exporter), so a user can no longer
 * pick "finance" and get an export that fails with NO_EXPORTER_FOR_MODULE.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { EXPORTERS, exportableModules, planExport } from "../src/modules/data-export/exporters.js";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET as string;
const bearer = (roles: string[]) => ({ authorization: `Bearer ${signToken({ sub: randomUUID(), roles, tid: randomUUID() } as never, SECRET)}` });

describe("exportableModules", () => {
  it("is exactly the distinct, sorted modules that have an exporter", () => {
    const expected = [...new Set(EXPORTERS.map((e) => e.module))].sort();
    expect(exportableModules()).toEqual(expected);
    expect(exportableModules().length).toBeGreaterThan(0);
  });
  it("every listed module can actually be planned for export; an unlisted one cannot", () => {
    for (const m of exportableModules()) expect(planExport("module", m, null).ok).toBe(true);
    expect(planExport("module", "finance", null)).toEqual({ ok: false, reason: "NO_EXPORTER_FOR_MODULE" });
    expect(exportableModules()).not.toContain("finance");
  });
});

describe("GET /v1/admin/data-export/modules", () => {
  afterAll(async () => { await sqlClient.end(); });

  it("returns the exportable modules to a tenant admin", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/admin/data-export/modules", headers: bearer(["tenant_admin"]) });
    await app.close();
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ data: exportableModules() });
  });

  it("refuses a caller who is not a tenant admin", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/admin/data-export/modules", headers: bearer(["employee"]) });
    const anon = await app.inject({ method: "GET", url: "/v1/admin/data-export/modules" });
    await app.close();
    expect(r.statusCode).toBe(403);
    expect(anon.statusCode).toBe(401);
  });
});

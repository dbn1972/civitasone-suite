/**
 * F133 (UAT bundle 17): scripts/backfill-admin-tenants.ts registers tenants that tenant-service has and the admin
 * directory lacks (e.g. 353c0e2c-..., created before the bundle 15 tenant.tenant.created fix). Real Postgres, app role
 * (FORCE RLS on tenants.admin_tenants), tenant-service listing faked.
 */
import { describe, it, expect, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { adminTenants } from "../src/modules/tenants/schema.js";
import * as repo from "../src/modules/tenants/repo.js";
import { backfillAdminTenants, makeTenantServiceLister, parseArgs, BACKFILL_ACTOR } from "../scripts/backfill-admin-tenants.js";

const T_HAVE = "f1331700-0000-4000-8000-000000000001";
const T_OLD = "f1331700-0000-4000-8000-000000000002";
const T_GOVT = "f1331700-0000-4000-8000-000000000003";
const T_BAD = "f1331700-0000-4000-8000-000000000004";
const T_DUP = "f1331700-0000-4000-8000-000000000005";
const ALL = [T_HAVE, T_OLD, T_GOVT, T_BAD, T_DUP];
const row = (id: string, o: Record<string, unknown> = {}) => ({
  id, name: `Office ${id.slice(-2)}`, domain: `b17-${id.slice(-2)}.example.in`, edition: "psu", status: "active", region: "ap-south-1", residency: "IN", ...o,
});
const LISTED = [
  row(T_HAVE),
  row(T_OLD),
  row(T_GOVT, { edition: "govt" }),
  row(T_BAD, { domain: "" }), // incomplete: never fabricated
  row(T_DUP, { domain: "b17-01.example.in" }), // the domain T_HAVE already holds
];
const listTenants = async () => LISTED;
const adminRow = (id: string) => runWithTenant(id, () => db.transaction((tx) => repo.findByIdTx(tx, id)));

afterAll(async () => {
  for (const id of ALL) {
    await runWithTenant(id, () => db.transaction((tx) => tx.delete(adminTenants).where(eq(adminTenants.id, id)))).catch(() => undefined);
  }
  await sqlClient.end();
});

describe("F133 backfill-admin-tenants", () => {
  it("--dry-run (the default) reports the missing tenants and writes nothing", async () => {
    await runWithTenant(T_HAVE, () => db.transaction((tx) => repo.insert(tx, {
      id: T_HAVE, tenantId: T_HAVE, name: "Existing Office", domain: "b17-01.example.in", edition: "psu", status: "active",
      region: "ap-south-1", residency: "IN", settings: {}, createdBy: BACKFILL_ACTOR, updatedBy: BACKFILL_ACTOR, version: 1,
    })));
    const r = await backfillAdminTenants({ listTenants, dryRun: true });
    expect(r.dryRun).toBe(true);
    expect(r.checked).toBe(5);
    expect(r.alreadyPresent).toEqual([T_HAVE]);
    expect(r.missing.map((m) => m.id).sort()).toEqual([T_DUP, T_GOVT, T_OLD].sort());
    expect(r.inserted).toEqual([]);
    expect(r.skipped.map((s) => s.id)).toEqual([T_BAD]);
    expect(await adminRow(T_OLD)).toBeNull();
    expect(await adminRow(T_GOVT)).toBeNull();
  });

  it("--apply inserts only the missing rows, under each tenant (RLS), never touching an existing row", async () => {
    const r = await backfillAdminTenants({ listTenants, dryRun: false });
    expect(r.inserted.sort()).toEqual([T_GOVT, T_OLD].sort());
    expect(r.skipped.map((s) => s.id).sort()).toEqual([T_BAD, T_DUP].sort());
    expect(r.skipped.find((s) => s.id === T_DUP)!.reason).toContain("already registered");
    expect(await adminRow(T_OLD)).toMatchObject({ name: "Office 02", domain: "b17-02.example.in", edition: "psu", status: "active" });
    expect(await adminRow(T_GOVT)).toMatchObject({ edition: "govt_dept" }); // same mapping as the live consumer
    expect(await adminRow(T_HAVE)).toMatchObject({ name: "Existing Office" }); // unchanged
    // RLS: the row is invisible from another tenant context
    const cross = await runWithTenant(T_HAVE, () => db.transaction((tx) => tx.select().from(adminTenants).where(eq(adminTenants.id, T_OLD))));
    expect(cross).toHaveLength(0);
  });

  it("is idempotent: a second --apply inserts nothing", async () => {
    const r = await backfillAdminTenants({ listTenants, dryRun: false });
    expect(r.inserted).toEqual([]);
    expect(r.alreadyPresent.sort()).toEqual([T_GOVT, T_HAVE, T_OLD].sort());
  });

  it("--tenant limits the run to the named tenants", async () => {
    const r = await backfillAdminTenants({ listTenants, dryRun: true, tenants: [T_OLD] });
    expect(r.checked).toBe(1);
  });
});

describe("tenant-service lister + args", () => {
  it("pages GET /v1/tenants over the internal seam until a short page", async () => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    const pages = [[row(T_OLD), row(T_GOVT)], [row(T_BAD)]];
    const fetchFn = async (url: string, init: { headers: Record<string, string> }) => {
      calls.push({ url, headers: init.headers });
      const data = pages[calls.length - 1] ?? [];
      return { ok: true, status: 200, text: async () => JSON.stringify({ data, total: 3 }) };
    };
    const list = makeTenantServiceLister({ baseUrl: "http://tenant.test/", secret: "s", fetchFn, pageSize: 2 });
    expect((await list()).map((t) => t.id)).toEqual([T_OLD, T_GOVT, T_BAD]);
    expect(calls.map((c) => c.url)).toEqual(["http://tenant.test/v1/tenants?limit=2&offset=0", "http://tenant.test/v1/tenants?limit=2&offset=2"]);
    expect(calls[0]!.headers).toMatchObject({ "x-internal": "1", "x-service-secret": "s" });
  });
  it("fails loudly on a tenant-service error (no partial plan)", async () => {
    const list = makeTenantServiceLister({ fetchFn: async () => ({ ok: false, status: 503, text: async () => "" }) });
    await expect(list()).rejects.toThrow("HTTP 503");
  });
  it("defaults to a dry run; --apply opts in", () => {
    expect(parseArgs([])).toEqual({ dryRun: true, tenants: [] });
    expect(parseArgs(["--apply", "--tenant", T_OLD])).toEqual({ dryRun: false, tenants: [T_OLD] });
    expect(() => parseArgs(["--apply", "--dry-run"])).toThrow();
    expect(() => parseArgs(["--tenant", "x"])).toThrow();
  });
});

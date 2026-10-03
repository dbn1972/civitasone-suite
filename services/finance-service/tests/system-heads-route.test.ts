/**
 * fp-assets-01: finance exposes the accounts it posts depreciation / disposals to, so asset-service never keeps its own
 * copy (it must refuse the accumulated-depreciation account as a capitalisation / lease head).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { signToken } from "@civitasone/auth";
import { systemHeads, ACCUM_DEP, FIXED_ASSET } from "../src/modules/gl/system-heads.js";
import { financeHeads } from "../src/modules/budget/schema.js";
import { sqlClient } from "../src/shared/db.js";
import { scoped } from "./_tenant.js";
import { eq } from "drizzle-orm";

const TEST_SERVICE_SECRET = process.env.INTERNAL_SERVICE_SECRET ?? "test_internal_secret_for_civitasone"; // gitleaks:allow
const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-0000000fb001";
let app: FastifyInstance;

beforeAll(async () => {
  process.env.INTERNAL_SERVICE_SECRET = TEST_SERVICE_SECRET;
  const { buildApp } = await import("../src/app.js");
  app = await buildApp();
  await app.ready();
});
const GROUP = "aaaaaaaa-0000-4000-8000-0000000fb0a1";
const DETAIL = "aaaaaaaa-0000-4000-8000-0000000fb0a2";
const LONE = "aaaaaaaa-0000-4000-8000-0000000fb0a3";
const ACTOR = "cccccccc-3333-4000-8000-0000000fb0aa";

afterAll(async () => {
  await scoped(TENANT, (tx) => tx.delete(financeHeads).where(eq(financeHeads.tenantId, TENANT)));
  await app.close();
  await sqlClient.end();
});

describe("GET /v1/finance/accounts?q= reports isLeaf (fp-assets-02: only a leaf account is postable)", () => {
  it("is false for a head that has children and true for a detail head and a lone head", async () => {
    await scoped(TENANT, async (tx) => {
      await tx.delete(financeHeads).where(eq(financeHeads.tenantId, TENANT));
      await tx.insert(financeHeads).values({ id: GROUP, tenantId: TENANT, code: "7700", name: "Payables group", level: 0, classification: "liability", createdBy: ACTOR, updatedBy: ACTOR });
      await tx.insert(financeHeads).values({ id: DETAIL, tenantId: TENANT, code: "7701", name: "Payables detail", level: 1, parentId: GROUP, classification: "liability", createdBy: ACTOR, updatedBy: ACTOR });
      await tx.insert(financeHeads).values({ id: LONE, tenantId: TENANT, code: "7800", name: "Standalone expense", level: 0, classification: "expense", createdBy: ACTOR, updatedBy: ACTOR });
    });
    const res = await app.inject({
      method: "GET", url: "/v1/finance/accounts?q=77",
      headers: { "x-internal": "1", "x-tenant-id": TENANT, "x-service-secret": TEST_SERVICE_SECRET },
    });
    expect(res.statusCode).toBe(200);
    const rows = JSON.parse(res.body).data as Array<{ code: string; isLeaf: boolean; type: string }>;
    expect(rows.find((r) => r.code === "7700")).toMatchObject({ isLeaf: false, type: "liability" });
    expect(rows.find((r) => r.code === "7701")).toMatchObject({ isLeaf: true, type: "liability" });
    const lone = JSON.parse((await app.inject({
      method: "GET", url: "/v1/finance/accounts?q=7800",
      headers: { "x-internal": "1", "x-tenant-id": TENANT, "x-service-secret": TEST_SERVICE_SECRET },
    })).body).data as Array<{ code: string; isLeaf: boolean }>;
    expect(lone[0]).toMatchObject({ code: "7800", isLeaf: true });
  });

  it("does not leak another tenant's accounts", async () => {
    const other = await app.inject({
      method: "GET", url: "/v1/finance/accounts?q=77",
      headers: { "x-internal": "1", "x-tenant-id": "bbbbbbbb-2222-4000-8000-0000000fb0b2", "x-service-secret": TEST_SERVICE_SECRET },
    });
    expect(JSON.parse(other.body).data).toEqual([]);
  });
});

describe("GET /v1/finance/accounts/system-heads", () => {
  it("returns the codes the GL consumer actually posts to", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/finance/accounts/system-heads",
      headers: { "x-internal": "1", "x-tenant-id": TENANT, "x-service-secret": TEST_SERVICE_SECRET },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual(systemHeads());
    expect(JSON.parse(res.body).accumulatedDepreciationCode).toBe(ACCUM_DEP);
    expect(JSON.parse(res.body).fixedAssetCode).toBe(FIXED_ASSET);
  });

  it("is not reachable without credentials, with a wrong service secret, or by a role that cannot read accounts", async () => {
    expect((await app.inject({ method: "GET", url: "/v1/finance/accounts/system-heads" })).statusCode).toBe(401);
    const wrong = await app.inject({
      method: "GET", url: "/v1/finance/accounts/system-heads",
      headers: { "x-internal": "1", "x-tenant-id": TENANT, "x-service-secret": `${TEST_SERVICE_SECRET}_wrong` },
    });
    expect(wrong.statusCode).toBe(401);
    const citizen = signToken({ sub: "cccccccc-3333-4000-8000-0000000fb001", tid: TENANT, roles: ["citizen"], sid: "s" } as never, SECRET, 3600);
    const denied = await app.inject({ method: "GET", url: "/v1/finance/accounts/system-heads", headers: { authorization: `Bearer ${citizen}` } });
    expect(denied.statusCode).toBe(403);
  });
});

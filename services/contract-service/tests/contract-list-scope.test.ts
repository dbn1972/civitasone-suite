/**
 * GAP-CONTRACTS-LIST-05 / GAP-CONTRACTS-HOME-05
 *
 * LIST-05: GET /v1/contract/contracts returns every field the web mapper
 *   (apps/web/.../_data/loaders.ts mapContractsListRows) reads — id, contractNo,
 *   title, vendorId, valueMinor, expiry, status — plus a stable pagination
 *   envelope.
 * HOME-05: both the contracts list and the obligations list are gated to
 *   reader roles and scoped to the caller's tenant. There is no department
 *   column on a contract, so scoping is tenant-level, not department-level —
 *   recorded as the deliberate answer to the HOME-05 question.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { eq } from "drizzle-orm";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { contractContracts } from "../src/modules/contracts/schema.js";
import { contractObligations } from "../src/modules/obligations/schema.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr"; // gitleaks:allow
const TENANT_A = "aaaaaaaa-8888-4000-8000-0000000000b1";
const TENANT_B = "bbbbbbbb-8888-4000-8000-0000000000b1";
const CON_A = "11111111-8888-4000-8000-0000000000b1";
const OBL_A = "22222222-8888-4000-8000-0000000000b1";
const USER = "99999999-8888-4000-8000-0000000000b1";
const VENDOR = "33333333-8888-4000-8000-0000000000b1";

function token(tenant: string, roles: string[]) {
  return signToken({ sub: "u-list05", tid: tenant, roles, sid: "s-list05" }, SECRET);
}

async function wipe() {
  for (const t of [TENANT_A, TENANT_B]) {
    await runWithTenant(t, () =>
      db.transaction(async (tx) => {
        await tx.delete(contractObligations).where(eq(contractObligations.tenantId, t));
        await tx.delete(contractContracts).where(eq(contractContracts.tenantId, t));
      }),
    );
  }
}

describe("GET /v1/contract/contracts + /obligations — fields, paging, scope", () => {
  beforeAll(async () => {
    await wipe();
    await runWithTenant(TENANT_A, () =>
      db.transaction(async (tx) => {
        await tx.insert(contractContracts).values({
          id: CON_A, tenantId: TENANT_A, contractNo: "CON-LIST05-1", vendorId: VENDOR,
          title: "List probe", valueMinor: 15000000n, currency: "INR",
          startDate: "2026-04-01", expiry: "2027-03-31", status: "active",
          createdBy: USER, updatedBy: USER,
        });
        await tx.insert(contractObligations).values({
          id: OBL_A, tenantId: TENANT_A, contractId: CON_A, title: "Submit report",
          dueDate: "2026-09-01", status: "pending", ownerId: USER,
          createdBy: USER, updatedBy: USER,
        });
      }),
    );
  });
  afterAll(async () => {
    await wipe();
    await sqlClient.end();
  });

  it("LIST-05: list row carries every field the web mapper reads, with a pagination envelope", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/contract/contracts",
      headers: { authorization: `Bearer ${token(TENANT_A, ["procurement_officer"])}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.pagination).toMatchObject({ pageSize: expect.any(Number) });
    const row = body.data.find((r: { id: string }) => r.id === CON_A);
    expect(row).toBeDefined();
    for (const key of ["contractNo", "title", "vendorId", "valueMinor", "expiry", "status"]) {
      expect(row[key], `missing ${key}`).toBeDefined();
    }
    expect(row.contractNo).toBe("CON-LIST05-1");
  });

  it("HOME-05: contracts list is tenant-scoped (tenant B sees none of tenant A's rows)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/contract/contracts",
      headers: { authorization: `Bearer ${token(TENANT_B, ["procurement_officer"])}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data.find((r: { id: string }) => r.id === CON_A)).toBeUndefined();
  });

  it("HOME-05: an unprivileged role cannot list contracts (403)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/contract/contracts",
      headers: { authorization: `Bearer ${token(TENANT_A, ["citizen"])}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("HOME-05: obligations list is reader-gated and tenant-scoped", async () => {
    const app = await buildApp();
    // Reader in tenant A sees the obligation.
    const okRes = await app.inject({
      method: "GET",
      url: `/v1/contract/obligations?contractId=${CON_A}`,
      headers: { authorization: `Bearer ${token(TENANT_A, ["procurement_officer"])}` },
    });
    expect(okRes.statusCode).toBe(200);
    expect(okRes.json().data.find((r: { id: string }) => r.id === OBL_A)).toBeDefined();

    // Tenant B sees nothing.
    const otherRes = await app.inject({
      method: "GET",
      url: `/v1/contract/obligations?contractId=${CON_A}`,
      headers: { authorization: `Bearer ${token(TENANT_B, ["procurement_officer"])}` },
    });
    expect(otherRes.statusCode).toBe(200);
    expect(otherRes.json().data.find((r: { id: string }) => r.id === OBL_A)).toBeUndefined();

    // Unprivileged role is rejected.
    const forbidden = await app.inject({
      method: "GET",
      url: `/v1/contract/obligations?contractId=${CON_A}`,
      headers: { authorization: `Bearer ${token(TENANT_A, ["citizen"])}` },
    });
    expect(forbidden.statusCode).toBe(403);
    await app.close();
  });
});

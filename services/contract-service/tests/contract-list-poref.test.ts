/**
 * GAP-PROCUREMENT-CONTRACTS-05: the contracts list is what the web register
 * links to a purchase order from, so GET /v1/contract/contracts must return
 * `poRef` for the caller's own contracts (and null where none is linked) and
 * must never return another tenant's contracts or their PO references.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { eq } from "drizzle-orm";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { contractContracts } from "../src/modules/contracts/schema.js";

const SECRET = process.env.JWT_SECRET as string;
const TENANT_A = "aaaaaaaa-8888-4000-8000-0000000000c5";
const TENANT_B = "bbbbbbbb-8888-4000-8000-0000000000c5";
const LINKED_A = "11111111-8888-4000-8000-0000000000c5";
const UNLINKED_A = "22222222-8888-4000-8000-0000000000c5";
const LINKED_B = "33333333-8888-4000-8000-0000000000c5";
const USER = "99999999-8888-4000-8000-0000000000c5";
const VENDOR = "44444444-8888-4000-8000-0000000000c5";
const PO_A = "procurement_po:55555555-8888-4000-8000-0000000000c5";
const PO_B = "procurement_po:66666666-8888-4000-8000-0000000000c5";

const token = (tenant: string, roles: string[]) =>
  signToken({ sub: "u-con05", tid: tenant, roles, sid: "s-con05" }, SECRET);

async function wipe() {
  for (const t of [TENANT_A, TENANT_B]) {
    await runWithTenant(t, () =>
      db.transaction(async (tx) => {
        await tx.delete(contractContracts).where(eq(contractContracts.tenantId, t));
      }),
    );
  }
}

function row(id: string, tenant: string, no: string, poRef: string | null) {
  return {
    id, tenantId: tenant, contractNo: no, vendorId: VENDOR, poRef,
    title: `Contract ${no}`, valueMinor: 250000n, currency: "INR",
    startDate: "2026-04-01", expiry: "2027-03-31", status: "active",
    createdBy: USER, updatedBy: USER,
  };
}

describe("GET /v1/contract/contracts -- poRef (GAP-PROCUREMENT-CONTRACTS-05)", () => {
  beforeAll(async () => {
    await wipe();
    await runWithTenant(TENANT_A, () =>
      db.transaction(async (tx) => {
        await tx.insert(contractContracts).values([
          row(LINKED_A, TENANT_A, "CON-POREF-A1", PO_A),
          row(UNLINKED_A, TENANT_A, "CON-POREF-A2", null),
        ]);
      }),
    );
    await runWithTenant(TENANT_B, () =>
      db.transaction(async (tx) => {
        await tx.insert(contractContracts).values([row(LINKED_B, TENANT_B, "CON-POREF-B1", PO_B)]);
      }),
    );
  });
  afterAll(async () => {
    await wipe();
    await sqlClient.end();
  });

  async function list(tenant: string) {
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: "GET",
        url: "/v1/contract/contracts",
        headers: { authorization: `Bearer ${token(tenant, ["procurement_officer"])}` },
      });
      expect(res.statusCode).toBe(200);
      return res.json().data as Array<{ id: string; poRef: string | null }>;
    } finally {
      await app.close();
    }
  }

  it("returns the linked PO reference for the caller's contracts, and null where none is linked", async () => {
    const rows = await list(TENANT_A);
    expect(rows.find((r) => r.id === LINKED_A)?.poRef).toBe(PO_A);
    expect(rows.find((r) => r.id === UNLINKED_A)?.poRef).toBeNull();
  });

  it("never returns another tenant's contracts or their PO references", async () => {
    const rowsA = await list(TENANT_A);
    expect(rowsA.find((r) => r.id === LINKED_B)).toBeUndefined();
    expect(JSON.stringify(rowsA)).not.toContain(PO_B);

    const rowsB = await list(TENANT_B);
    expect(rowsB.map((r) => r.id)).toEqual([LINKED_B]);
    expect(rowsB[0]!.poRef).toBe(PO_B);
    expect(JSON.stringify(rowsB)).not.toContain(PO_A);
  });
});

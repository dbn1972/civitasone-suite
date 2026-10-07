/**
 * GAP-CONTRACTS-NEW-05 / GAP-CONTRACTS-NEW-06
 *
 * POST /v1/contract/contracts must:
 *  - reject a duplicate (tenant, contractNo) with a synchronous 409
 *    DUPLICATE_NUMBER (not let the queue consumer trip the UNIQUE constraint
 *    asynchronously), and
 *  - reject an expiry that precedes the start date with a 400.
 *
 * The happy path still returns 202 (queue-first) and the zod envelope still
 * returns 400 with fieldErrors for a malformed body.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { eq } from "drizzle-orm";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { contractContracts } from "../src/modules/contracts/schema.js";

const SECRET = process.env.JWT_SECRET as string;
const TENANT = "aaaaaaaa-7777-4000-8000-0000000000a5";
const DUP_NO = "CON-DUP-NEW05";
const SEEDED = "55555555-7777-4000-8000-0000000000a5";

function token(roles: string[] = ["procurement_admin"]) {
  return signToken({ sub: "user-new05", tid: TENANT, roles, sid: "sess-new05" }, SECRET);
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    contractNo: DUP_NO,
    vendorId: "bbbbbbbb-7777-4000-8000-0000000000a5",
    title: "Duplicate-number probe",
    valueMinor: 500000,
    currency: "INR",
    startDate: "2026-04-01",
    expiry: "2027-03-31",
    ...overrides,
  };
}

async function wipe() {
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.delete(contractContracts).where(eq(contractContracts.tenantId, TENANT));
    }),
  );
}

describe("POST /v1/contract/contracts — duplicate number + date ordering", () => {
  beforeAll(async () => {
    await wipe();
    // Seed an existing contract with the number we will try to re-use.
    await runWithTenant(TENANT, () =>
      db.transaction(async (tx) => {
        await tx.insert(contractContracts).values({
          id: SEEDED,
          tenantId: TENANT,
          contractNo: DUP_NO,
          vendorId: "bbbbbbbb-7777-4000-8000-0000000000a5",
          title: "Pre-existing contract",
          valueMinor: 100000n,
          currency: "INR",
          startDate: "2026-01-01",
          expiry: "2026-12-31",
          status: "draft",
          createdBy: "99999999-7777-4000-8000-0000000000a5",
          updatedBy: "99999999-7777-4000-8000-0000000000a5",
        });
      }),
    );
  });
  afterAll(async () => {
    await wipe();
    await sqlClient.end();
  });

  it("rejects a duplicate contract number with 409 DUPLICATE_NUMBER", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/contract/contracts",
      headers: { authorization: `Bearer ${token()}` },
      payload: validBody(),
    });
    await app.close();
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("DUPLICATE_NUMBER");
  });

  it("rejects an expiry that precedes the start date with 400", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/contract/contracts",
      headers: { authorization: `Bearer ${token()}` },
      payload: validBody({ contractNo: "CON-NEW06-ORDER", startDate: "2027-03-31", expiry: "2026-04-01" }),
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("still returns a 400 zod envelope with fieldErrors for a malformed body (GAP-CONTRACTS-NEW-06)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/contract/contracts",
      headers: { authorization: `Bearer ${token()}` },
      payload: { contractNo: "", vendorId: "not-a-uuid", title: "", valueMinor: -1, startDate: "2026-04-01", expiry: "2027-03-31" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_FAILED");
    expect(Array.isArray(res.json().fieldErrors)).toBe(true);
  });

  it("accepts a fresh contract number with 202", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/contract/contracts",
      headers: { authorization: `Bearer ${token()}` },
      payload: validBody({ contractNo: "CON-NEW05-FRESH" }),
    });
    await app.close();
    expect(res.statusCode).toBe(202);
  });
});

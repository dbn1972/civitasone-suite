/**
 * Contracts hub expiry buckets are whole-tenant server aggregates.
 *
 * The hub derived "Expiring in 30/60/90 days" and "Expired (open)" from the rows
 * of ONE default page of GET /v1/contract/contracts (50), so a tenant with more
 * contracts than that saw under-counted, silently capped figures. The list now
 * returns meta.expiry + pagination.total computed over every contract.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { eq } from "drizzle-orm";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { contractContracts } from "../src/modules/contracts/schema.js";

const SECRET = process.env.JWT_SECRET as string;
const TENANT = randomUUID();
const OTHER = randomUUID();
const USER = randomUUID();
const VENDOR = randomUUID();

/** YYYY-MM-DD, `offsetDays` from today's Asia/Kolkata calendar date. */
function istDate(offsetDays: number): string {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

let seq = 0;
function contract(tenantId: string, expiry: string, status = "active") {
  seq += 1;
  return {
    id: randomUUID(), tenantId, contractNo: `CON-EXP-${seq}`, vendorId: VENDOR, title: `c${seq}`,
    valueMinor: 100n, currency: "INR", startDate: "2020-01-01", expiry, status,
    createdBy: USER, updatedBy: USER,
  };
}

const auth = (tid: string) => ({ authorization: `Bearer ${signToken({ sub: "u-exp", tid, roles: ["procurement_admin"], sid: "s-exp" }, SECRET)}` });

beforeAll(async () => {
  const rows = [
    ...Array.from({ length: 3 }, () => contract(TENANT, istDate(10))),
    ...Array.from({ length: 2 }, () => contract(TENANT, istDate(45))),
    contract(TENANT, istDate(80)),
    contract(TENANT, istDate(0)),                                   // expires today: still in the 30-day window, not expired
    ...Array.from({ length: 4 }, () => contract(TENANT, istDate(-5))),            // expired, still open
    contract(TENANT, istDate(-5), "closed"),                        // expired but closed: not outstanding
    contract(TENANT, istDate(-5), "terminated"),
    ...Array.from({ length: 49 }, () => contract(TENANT, istDate(400))),         // far future: pushes total past one page
  ];
  await runWithTenant(TENANT, () => db.transaction((tx) => tx.insert(contractContracts).values(rows)));
  await runWithTenant(OTHER, () => db.transaction((tx) => tx.insert(contractContracts).values(contract(OTHER, istDate(5)))));
});
afterAll(async () => {
  for (const t of [TENANT, OTHER]) {
    await runWithTenant(t, () => db.transaction((tx) => tx.delete(contractContracts).where(eq(contractContracts.tenantId, t))));
  }
  await sqlClient.end();
});

describe("GET /v1/contract/contracts meta.expiry", () => {
  it("counts every contract of the tenant, not just the 50 listed", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/contract/contracts", headers: auth(TENANT) });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(50);                 // the capped page
    expect(body.meta.total).toBe(62);                   // ...but the true total
    expect(body.pagination).toMatchObject({ total: 62, hasMore: true, pageSize: 50 });
    expect(body.meta.expiry).toEqual({
      in30: 3 + 1,        // +10d x3 and expires-today
      in60: 3 + 1 + 2,    // + the +45d pair
      in90: 3 + 1 + 2 + 1,
      expiredOpen: 4,     // closed / terminated excluded
    });
  });

  it("is tenant-scoped", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/contract/contracts", headers: auth(OTHER) });
    await app.close();
    expect(res.json().meta).toEqual({ total: 1, expiry: { in30: 1, in60: 1, in90: 1, expiredOpen: 0 } });
  });
});

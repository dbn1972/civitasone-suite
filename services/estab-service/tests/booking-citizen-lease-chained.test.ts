/**
 * PR #1949 review round 1 — CHAINED booking + citizen-lease workflows, driven
 * through the real HTTP routes, the real command publishers (so the REAL
 * messageIds) and the real consumers on the in-memory queue, against Postgres.
 *
 * The earlier tests delivered create commands only, with fresh UUIDs, so they
 * missed that every command published messageId = entity id: after `create`
 * claimed the id in _inbox.processed, submit/approve/pay/complete were all
 * dropped while the API still answered 202. Each step below asserts the state
 * change, so that bug fails here at the first transition.
 *
 * Also covers: payment authz, ownership (IDOR), PII masking + audited reveal,
 * money-field validation, and noDuesCertificateRef threading.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { estabFacilitiesCatalog, estabBookings } from "../src/modules/booking/schema.js";
import { estabLeaseProperties, estabLeases, estabLeasePayments, estabLeaseRequests } from "../src/modules/citizen-lease/schema.js";
import { registerBookingConsumers } from "../src/modules/booking/consumer.js";
import { registerCitizenLeaseConsumers } from "../src/modules/citizen-lease/consumer.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "7ca10001-0000-4000-8000-0000000000e1";
const ADMIN = "7ca10001-0000-4000-8000-0000000000e2";
const CIT_A = "7ca10001-0000-4000-8000-0000000000e3";
const CIT_B = "7ca10001-0000-4000-8000-0000000000e4";
const FIN = "7ca10001-0000-4000-8000-0000000000e5";
const AUDITOR = "7ca10001-0000-4000-8000-0000000000e6";

function as(actor: string, roles: string[]) {
  const token = signToken({ sub: actor, tid: TENANT, roles, sid: "s1" }, SECRET, 3600);
  // The gateway injects x-tenant-id; createTenantTxHook reads it to set the RLS GUC.
  return { authorization: `Bearer ${token}`, "x-tenant-id": TENANT };
}
const admin = () => as(ADMIN, ["estab_admin"]);
const citA = () => as(CIT_A, ["citizen"]);
const citB = () => as(CIT_B, ["citizen"]);
const fin = () => as(FIN, ["finance_officer"]);
const auditor = () => as(AUDITOR, ["audit_officer"]);

let app: FastifyInstance;
beforeAll(async () => {
  registerBookingConsumers(queue);
  registerCitizenLeaseConsumers(queue);
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(estabBookings).where(eq(estabBookings.tenantId, TENANT));
    await tx.delete(estabFacilitiesCatalog).where(eq(estabFacilitiesCatalog.tenantId, TENANT));
    await tx.delete(estabLeaseRequests).where(eq(estabLeaseRequests.tenantId, TENANT));
    await tx.delete(estabLeasePayments).where(eq(estabLeasePayments.tenantId, TENANT));
    await tx.delete(estabLeases).where(eq(estabLeases.tenantId, TENANT));
    await tx.delete(estabLeaseProperties).where(eq(estabLeaseProperties.tenantId, TENANT));
  }));
  await sqlClient`DELETE FROM _outbox.messages WHERE tenant_id = ${TENANT}`;
  await app.close();
  await sqlClient.end();
});

async function post(url: string, headers: Record<string, string>, payload: unknown = {}) {
  const res = await app.inject({ method: "POST", url, headers, payload: payload as object });
  await queue.drain();
  return res;
}
async function get(url: string, headers: Record<string, string>) {
  return app.inject({ method: "GET", url, headers });
}
const idOf = (res: { json: () => Record<string, unknown> }): string => {
  const b = res.json();
  return String((b.data as { id?: string } | undefined)?.id ?? b.id);
};

describe("booking — chained workflow with real messageIds", () => {
  it("create -> submit -> approve -> pay -> complete each change state; authz + IDOR + PII hold", async () => {
    const fac = await post("/v1/estab/booking/facilities", admin(), {
      facilityName: "Town Hall", facilityType: "community_hall", ratePerHourMinor: 100000, securityDepositMinor: 500000,
    });
    expect(fac.statusCode).toBe(202);
    const facilityId = idOf(fac);

    const created = await post("/v1/estab/booking/bookings", citA(), {
      facilityId, applicantName: "Asha", applicantPhone: "9876543210", applicantEmail: "asha@example.org",
      eventDate: "2026-12-01", startTime: "10:00", endTime: "14:00", durationHours: 4,
    });
    expect(created.statusCode).toBe(202);
    const id = idOf(created);
    const url = `/v1/estab/booking/bookings/${id}`;
    expect((await get(url, admin())).json().data.status).toBe("draft");

    // IDOR: another citizen can neither read, list, submit nor cancel it.
    expect((await get(url, citB())).statusCode).toBe(404);
    expect((await get("/v1/estab/booking/bookings", citB())).json().data).toHaveLength(0);
    expect((await post(`${url}/submit`, citB())).statusCode).toBe(404);
    expect((await post(`${url}/cancel`, citB(), {})).statusCode).toBe(404);
    expect((await get(url, admin())).json().data.status).toBe("draft");

    // Owner sees their own record, PII masked.
    const own = (await get(url, citA())).json().data;
    expect(own.applicantPhone).toBe("******3210");
    expect(own.applicantEmail).toBe("a***@example.org");

    // submit (2nd command on this entity — dropped by the old messageId = id).
    expect((await post(`${url}/submit`, citA())).statusCode).toBe(202);
    expect((await get(url, citA())).json().data.status).toBe("submitted");

    expect((await post(`${url}/approve`, admin())).statusCode).toBe(202);
    expect((await get(url, admin())).json().data.status).toBe("approved");

    // Payment is not for the citizen who owes it.
    expect((await post(`${url}/pay`, citA(), { paymentRef: "FAKE" })).statusCode).toBe(403);
    expect((await get(url, admin())).json().data.status).toBe("approved");
    expect((await post(`${url}/pay`, fin(), { paymentRef: "PAY-1" })).statusCode).toBe(202);
    const paid = (await get(url, admin())).json().data;
    expect(paid.status).toBe("confirmed");
    expect(paid.paymentRef).toBe("PAY-1");

    expect((await post(`${url}/complete`, admin())).statusCode).toBe(202);
    expect((await get(url, admin())).json().data.status).toBe("completed");

    // Officer reveal is unmasked and audited.
    const revealed = (await get(url, admin())).json().data;
    expect(revealed.applicantPhone).toBe("9876543210");
    const audits = await sqlClient`SELECT payload FROM _outbox.messages WHERE tenant_id = ${TENANT} AND topic = 'audit.event.record'`;
    const reveal = (audits as unknown as Array<{ payload: Record<string, unknown> }>)
      .map((r) => r.payload).filter((p) => p.action === "pii_revealed" && p.resourceId === id);
    expect(reveal.length).toBeGreaterThan(0);
  });
});

describe("citizen-lease — chained workflow, authz, PII, money validation", () => {
  it("lease request create -> review -> complete keeps noDuesCertificateRef; rent is accounts-only", async () => {
    const prop = await post("/v1/estab/citizen-lease/properties", admin(), {
      propertyCode: "SHOP-1", propertyType: "shop", monthlyRentMinor: "1500000",
    });
    expect(prop.statusCode).toBe(202);
    const propertyId = idOf(prop);

    // Money fields must be digits-only: non-numeric is a 400, not a swallowed consumer error.
    const bad = await post("/v1/estab/citizen-lease/properties", admin(), {
      propertyCode: "SHOP-X", propertyType: "shop", monthlyRentMinor: "12abc",
    });
    expect(bad.statusCode).toBe(400);

    const leaseRes = await post("/v1/estab/citizen-lease/leases", admin(), {
      propertyId, tenantName: "Ravi", tenantPhone: "9123456780", tenantAadhaar: "123456789012",
      leaseStartDate: "2026-01-01", leaseEndDate: "2028-12-31", monthlyRentMinor: "1500000",
    });
    expect(leaseRes.statusCode).toBe(202);
    const leaseId = idOf(leaseRes);
    const leaseUrl = `/v1/estab/citizen-lease/leases/${leaseId}`;

    // PII: audit_officer reads masked; estab_admin reads clear (audited); citizen sees nothing of others'.
    const forAuditor = (await get(leaseUrl, auditor())).json().data;
    expect(forAuditor.tenantAadhaar).toBe("********9012");
    expect(forAuditor.tenantPhone).toBe("******6780");
    expect((await get(leaseUrl, admin())).json().data.tenantAadhaar).toBe("123456789012");
    expect((await get(leaseUrl, citB())).statusCode).toBe(404);
    expect((await get("/v1/estab/citizen-lease/leases", citB())).json().data).toHaveLength(0);
    expect((await get(`${leaseUrl}/payments`, citB())).statusCode).toBe(404);

    // Rent payments: accounts/officers only. citizen, employee and audit_officer are refused.
    const pay = { paymentMonth: "2026-02", amountMinor: "1500000", dueDate: "2026-02-05", paymentRef: "RENT-1" };
    expect((await post(`${leaseUrl}/payments`, citA(), pay)).statusCode).toBe(403);
    expect((await post(`${leaseUrl}/payments`, as(CIT_A, ["employee"]), pay)).statusCode).toBe(403);
    expect((await post(`${leaseUrl}/payments`, auditor(), pay)).statusCode).toBe(403);
    expect((await post(`${leaseUrl}/payments`, admin(), { ...pay, amountMinor: "1e6" })).statusCode).toBe(400);
    expect((await post(`${leaseUrl}/payments`, admin(), pay)).statusCode).toBe(202);
    const payments = (await get(`${leaseUrl}/payments`, admin())).json().data;
    expect(payments).toHaveLength(1);
    expect(payments[0].status).toBe("paid");

    // Request workflow: submit (citizen) -> review -> complete with a certificate ref.
    const reqRes = await post("/v1/estab/citizen-lease/requests", citA(), { leaseId, requestType: "no_dues" });
    expect(reqRes.statusCode).toBe(202);
    const requestId = idOf(reqRes);
    const reqUrl = `/v1/estab/citizen-lease/requests/${requestId}`;
    expect((await get(reqUrl, citA())).json().data.status).toBe("submitted");
    expect((await get(reqUrl, citB())).statusCode).toBe(404);

    expect((await post(`${reqUrl}/review`, admin(), { decision: "approved" })).statusCode).toBe(202);
    expect((await get(reqUrl, admin())).json().data.status).toBe("approved");

    expect((await post(`${reqUrl}/complete`, admin(), { noDuesCertificateRef: "NDC-2026-0042" })).statusCode).toBe(202);
    const done = (await get(reqUrl, admin())).json().data;
    expect(done.status).toBe("completed");
    expect(done.noDuesCertificateRef).toBe("NDC-2026-0042");
  });
});

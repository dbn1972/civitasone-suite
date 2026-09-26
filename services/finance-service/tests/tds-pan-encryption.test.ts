/**
 * TDS vendor PAN — encryption-at-rest column-width regression test.
 *
 * PROVEN BUG (finance-service functional sweep): gl.finance_vendor_tds.pan
 * was varchar(10) — sized for a real plaintext PAN ("ABCPD1234E") — but
 * tds/consumer.ts encrypts the PAN before insert (encryptPii, AES-256-GCM
 * envelope: "enc:v2:<keyid>:" + base64(IV||tag||ct)), which measures 62
 * chars for a real 10-char PAN against this service's own encryptPii (see
 * migration 0080's comment for the measurement). Postgres rejected every
 * such insert with "value too long for type character varying(10)" — AFTER
 * POST /v1/finance/vendor-tds had already returned 202, so the caller never
 * saw the failure. A request with no PAN (nothing to encrypt, pan stays
 * null) was unaffected, which is why this was easy to miss: PAN is
 * mandatory for a real Form 26Q/TRACES statutory filing, so in practice
 * this silently dropped every real-world deduction and left the 26Q return
 * permanently PAN-less.
 *
 * THE GAP THAT HID THIS: the two pre-existing TDS tests never combine a
 * real Postgres with a registered consumer —
 *   - dom-013-tds-route.test.ts hits the route via buildApp() against a
 *     real DB but never registers registerTdsConsumers, so the published
 *     command is never drained by anything and no row is ever inserted.
 *   - consumer-coverage-ext.test.ts registers the consumer and drains it,
 *     but mocks shared/db.js's execute() to unconditionally resolve
 *     [{ id: "gen-id-001" }], so a real column-width violation can never
 *     surface.
 * This file closes that gap: it registers registerTdsConsumers on the SAME
 * queue singleton buildApp()'s routes publish to (shared/infra.js's
 * `queue`), against a real Postgres, so POST -> consumer -> GET is a true
 * end-to-end round trip — the only way this bug (or a regression of it) is
 * actually observable.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { queue } from "../src/shared/infra.js";
import { sqlClient } from "../src/shared/db.js";
import { registerTdsConsumers } from "../src/modules/tds/consumer.js";
import { financeVendorTds } from "../src/modules/tds/repo.js";
import { scoped } from "./_tenant.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "b7b7b7b7-3333-4000-8000-0000000000d3";

function token(roles: string[] = ["finance_officer"]) {
  // sub must be a UUID: it flows through to ctx.actorId, which the consumer
  // persists into UUID columns (e.g. outbox actor_id). dom-013-tds-route
  // .test.ts gets away with a non-UUID "user-001" only because it never
  // registers a consumer to drain the message that would expose this.
  return signToken({ sub: "c7c7c7c7-4444-4000-8000-0000000000d4", tid: TENANT, roles, sid: "sess-tds-001" }, SECRET);
}

// Wrap the shared queue singleton's subscribe the exact same way worker.ts
// does in production, so the consumer's db.transaction() runs under the
// message's tenant GUC (RLS) — without this, FORCE ROW LEVEL SECURITY
// silently filters/rejects the write and any failure looks like a
// different bug entirely. Mirrors tests/gl-journal-zero-amount-approval
// .test.ts's tenantWrappedQueue() helper, applied here to the real app
// singleton (not a fresh MemoryQueue) since routes.ts's POST handler
// publishes to that exact singleton and this file needs the route AND the
// consumer sharing one queue. Runs once at module load (this file's own
// isolated module graph — see vitest.config.ts).
type Drainable = { subscribe: (topic: string, handler: (msg: any) => Promise<void>) => void; drain(): Promise<void> };
const q = queue as unknown as Drainable;
const rawSubscribe = q.subscribe.bind(q);
q.subscribe = (topic, handler) =>
  rawSubscribe(topic, (msg: any) => runWithTenant(msg.tenantId, () => handler(msg)));
registerTdsConsumers(queue);

async function clean(fy: string) {
  await scoped(TENANT, (tx) => tx.delete(financeVendorTds).where(eq(financeVendorTds.fy, fy)));
}

afterAll(async () => { await sqlClient.end(); });

describe("POST /v1/finance/vendor-tds -> consumer -> GET — PAN encryption round trip", () => {
  it("a deduction WITH a real PAN persists and round-trips the exact plaintext PAN", async () => {
    const fy = "2026-27";
    await clean(fy);
    const app = await buildApp();
    const pan = "ABCPD1234E";

    const postRes = await app.inject({
      method: "POST",
      url: "/v1/finance/vendor-tds",
      headers: { authorization: `Bearer ${token()}` },
      payload: {
        vendorId: randomUUID(), vendorName: "Test Contractor Pvt Ltd", pan,
        section: "194C", grossAmountMinor: 100000, tdsRatePct: 2, tdsAmountMinor: 2000,
        netPaymentMinor: 98000, deductionDate: "2026-09-11", quarter: "Q2", fy,
      },
    });
    expect(postRes.statusCode).toBe(202);

    await q.drain();

    // THE BUG, if unfixed: the consumer's insert throws "value too long for
    // type character varying(10)" (encryptPii(pan) is 62 chars), retries
    // exhaust, the message dead-letters, and the row is never created — so
    // this GET returns zero rows for `fy` even though POST answered 202.
    const getRes = await app.inject({
      method: "GET",
      url: `/v1/finance/vendor-tds?fy=${fy}&quarter=Q2`,
      headers: { authorization: `Bearer ${token()}` },
    });
    expect(getRes.statusCode).toBe(200);
    const rows = getRes.json().data as Array<{ pan: string | null; vendor_name: string }>;
    expect(rows).toHaveLength(1);
    // Decrypted back to the ORIGINAL plaintext — proves the write-side
    // encrypt and read-side decrypt round-trip exactly, not just "some
    // string came back."
    expect(rows[0].pan).toBe(pan);
    expect(rows[0].vendor_name).toBe("Test Contractor Pvt Ltd");

    const form26qRes = await app.inject({
      method: "GET",
      url: `/v1/finance/vendor-tds/form-26q?fy=${fy}&quarter=Q2`,
      headers: { authorization: `Bearer ${token()}` },
    });
    expect(form26qRes.statusCode).toBe(200);
    const deductees = form26qRes.json().deductees as Array<{ pan: string | null }>;
    expect(deductees).toHaveLength(1);
    // The actual statutory-filing-integrity assertion: Form 26Q must carry
    // the real PAN, not null.
    expect(deductees[0].pan).toBe(pan);

    await app.close();
  });

  it("control: a deduction WITHOUT a PAN still persists with pan: null (unaffected by this fix)", async () => {
    const fy = "2027-28";
    await clean(fy);
    const app = await buildApp();

    const postRes = await app.inject({
      method: "POST",
      url: "/v1/finance/vendor-tds",
      headers: { authorization: `Bearer ${token()}` },
      payload: {
        vendorId: randomUUID(), vendorName: "No-PAN Vendor",
        section: "194C", grossAmountMinor: 50000, tdsRatePct: 2, tdsAmountMinor: 1000,
        netPaymentMinor: 49000, deductionDate: "2027-09-11", quarter: "Q2", fy,
      },
    });
    expect(postRes.statusCode).toBe(202);

    await q.drain();

    const getRes = await app.inject({
      method: "GET",
      url: `/v1/finance/vendor-tds?fy=${fy}&quarter=Q2`,
      headers: { authorization: `Bearer ${token()}` },
    });
    expect(getRes.statusCode).toBe(200);
    const rows = getRes.json().data as Array<{ pan: string | null }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].pan).toBeNull();

    await app.close();
  });
});

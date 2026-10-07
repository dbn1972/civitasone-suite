/**
 * GAP-COURT-ORDERS-02 — server-side DSC (Digital Signature Certificate)
 * verification for judicial order issuance (REAL Postgres, assembled app +
 * REAL worker).
 *
 * Proves the backend capability that was previously missing (the web side only
 * did a structural base64/PEM check, with NO cryptographic verification):
 *
 *   1. POST /v1/court/orders/:id/verify-dsc verifies a GENUINE detached PKCS#7
 *      signature over the order's canonical content (signer CN, validity,
 *      cryptographic signature) — read-only, no state change.
 *   2. A TAMPERED signature (wrong content) is rejected (digest_mismatch).
 *   3. Chain-of-trust is reported fail-closed when no trust store is configured.
 *   4. approve-issue with a VALID signature issues the order AND persists the
 *      verified signer metadata (dsc_signer_cn).
 *   5. approve-issue with an INVALID (mis-pasted) signature is rejected 422
 *      DSC_VERIFICATION_FAILED and the order STAYS pending_approval (never
 *      issued) — the integrity crux.
 *
 * Opt-in via COURT_E2E=1 with a real DATABASE_URL on localhost:5672.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { signDetachedPkcs7, generateTestDscKeypair } from "@civitasone/render";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { subscribeConsumers } from "../src/worker.js";
import { queue } from "../src/shared/infra.js";
import { sqlClient } from "../src/shared/db.js";
import { canonicalOrderContent } from "../src/modules/order-issuance/dsc-verify.js";

const RUN = process.env.COURT_E2E === "1";
const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

const TENANT = randomUUID();
const MAKER = "11110000-1111-4111-8111-111111111111"; // drafted the order
const CHECKER = "22220000-2222-4222-8222-222222222222"; // approves + issues (≠ maker)

function token(actorId: string, roles: string[]): string {
  return signToken({ sub: actorId, tid: TENANT, roles, sid: "sess-dsc" }, SECRET, 3600);
}

let app: FastifyInstance;

async function insertOrder(
  id: string,
  fields: { orderType: string; orderText: string; orderDate: string; status: string },
): Promise<void> {
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    const caseId = randomUUID();
    // orders.case_id FKs court.cases — insert the parent case first.
    await sql`insert into court.cases (id, tenant_id, cnr_number, status, version)
              values (${caseId}, ${TENANT}, ${"CNR-" + id.slice(0, 8)}, ${"filed"}, 1)`;
    await sql`insert into court.orders
      (id, tenant_id, case_id, order_type, order_text, order_date, status, created_by, version)
      values (${id}, ${TENANT}, ${caseId}, ${fields.orderType}, ${fields.orderText},
              ${fields.orderDate}, ${fields.status}, ${MAKER}, 1)`;
  });
}

async function readOrder(id: string): Promise<{ status: string; dsc_signer_cn: string | null } | undefined> {
  return sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    const rows = await sql`select status, dsc_signer_cn from court.orders where id = ${id} and tenant_id = ${TENANT}`;
    return rows[0] as { status: string; dsc_signer_cn: string | null } | undefined;
  });
}

async function waitFor(pred: () => Promise<boolean>, tries = 60, gapMs = 25): Promise<boolean> {
  for (let i = 0; i < tries; i++) { if (await pred()) return true; await new Promise((r) => setTimeout(r, gapMs)); }
  return false;
}

// FLAKY-SKIP: requires COURT_E2E=1 plus a real Postgres on localhost:5672; the default vitest run mocks the DB. (expires: 2026-12-13)
// FLAKY-SKIP: Requires COURT_E2E=1 plus a live court-service stack (real Postgres + HTTP); unset in standard CI so this e2e suite never executes there. (expires: 2026-12-13)
describe.skipIf(!RUN)("GAP-COURT-ORDERS-02 server-side DSC verification (real DB)", () => {
  const kp = generateTestDscKeypair({ cn: "Hon'ble District Judge" });
  const orderFields = { orderType: "final", orderText: "The petition is allowed.", orderDate: "2026-07-11", status: "pending_approval" };

  const verifyOrderId = randomUUID();
  const issueOkOrderId = randomUUID();
  const issueBadOrderId = randomUUID();

  beforeAll(async () => {
    subscribeConsumers();
    await queue.start();
    app = await buildApp();
    await insertOrder(verifyOrderId, orderFields);
    await insertOrder(issueOkOrderId, orderFields);
    await insertOrder(issueBadOrderId, orderFields);
  });

  afterAll(async () => {
    await queue.stop();
    await sqlClient.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
      await sql`delete from court.orders where tenant_id = ${TENANT}`;
      await sql`delete from court.cases where tenant_id = ${TENANT}`;
    });
    await app.close();
    await sqlClient.end();
  });

  // Build the exact canonical content the SERVER verifies (it reads the row's
  // real caseId), by reconstructing it from the committed row.
  async function serverCanonicalContent(id: string): Promise<string> {
    const row = await sqlClient.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
      const rows = await sql`select id, case_id, order_type, order_text, order_date from court.orders where id = ${id} and tenant_id = ${TENANT}`;
      return rows[0] as { id: string; case_id: string; order_type: string; order_text: string; order_date: string | Date };
    });
    return canonicalOrderContent({
      id: row.id,
      caseId: row.case_id,
      orderType: row.order_type,
      orderText: row.order_text,
      orderDate: typeof row.order_date === "string" ? row.order_date : new Date(row.order_date).toISOString().slice(0, 10),
    });
  }

  it("verifies a genuine detached DSC signature over the order (signatureValid true)", async () => {
    const content = await serverCanonicalContent(verifyOrderId);
    const sig = signDetachedPkcs7({ content, privateKeyPem: kp.privateKeyPem, certificatePem: kp.certificatePem });
    const res = await app.inject({
      method: "POST",
      url: `/v1/court/orders/${verifyOrderId}/verify-dsc`,
      headers: { authorization: `Bearer ${token(CHECKER, ["judge"])}`, "content-type": "application/json" },
      payload: { dscSignature: sig },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; structureValid: boolean; signatureValid: boolean; signerCN: string; chainTrusted: boolean; trustStoreConfigured: boolean };
    expect(body.structureValid).toBe(true);
    expect(body.signatureValid).toBe(true);
    expect(body.ok).toBe(true);
    expect(body.signerCN).toBe("Hon'ble District Judge");
    expect(body.chainTrusted).toBe(false);
    expect(body.trustStoreConfigured).toBe(false);
  });

  it("rejects a tampered signature (signed over different content → digest_mismatch)", async () => {
    const sig = signDetachedPkcs7({ content: "entirely different bytes", privateKeyPem: kp.privateKeyPem, certificatePem: kp.certificatePem });
    const res = await app.inject({
      method: "POST",
      url: `/v1/court/orders/${verifyOrderId}/verify-dsc`,
      headers: { authorization: `Bearer ${token(CHECKER, ["judge"])}`, "content-type": "application/json" },
      payload: { dscSignature: sig },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; issues: string[] };
    expect(body.ok).toBe(false);
    expect(body.issues).toContain("digest_mismatch");
  });

  it("denies verify-dsc from a non-checker role (403)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/court/orders/${verifyOrderId}/verify-dsc`,
      headers: { authorization: `Bearer ${token(CHECKER, ["court_clerk"])}`, "content-type": "application/json" },
      payload: { dscSignature: "x".repeat(80) },
    });
    expect(res.statusCode).toBe(403);
  });

  it("approve-issue with a VALID signature issues the order and persists signer metadata", async () => {
    const content = await serverCanonicalContent(issueOkOrderId);
    const sig = signDetachedPkcs7({ content, privateKeyPem: kp.privateKeyPem, certificatePem: kp.certificatePem });
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/court/orders/${issueOkOrderId}/approve-issue`,
      headers: { authorization: `Bearer ${token(CHECKER, ["judge"])}`, "content-type": "application/json" },
      payload: { dscSignature: sig, expectedVersion: 1 },
    });
    expect(res.statusCode).toBe(202); // command accepted (pre-check incl. DSC passed)
    const issued = await waitFor(async () => (await readOrder(issueOkOrderId))?.status === "issued");
    expect(issued).toBe(true);
    const row = await readOrder(issueOkOrderId);
    expect(row?.dsc_signer_cn).toBe("Hon'ble District Judge");
  });

  it("approve-issue with an INVALID (mis-pasted) signature is rejected 422 and the order stays pending", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/court/orders/${issueBadOrderId}/approve-issue`,
      headers: { authorization: `Bearer ${token(CHECKER, ["judge"])}`, "content-type": "application/json" },
      payload: { dscSignature: "not-a-real-signature-just-a-mis-pasted-password-string-value", expectedVersion: 1 },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("DSC_VERIFICATION_FAILED");
    await new Promise((r) => setTimeout(r, 300));
    expect((await readOrder(issueBadOrderId))?.status).toBe("pending_approval");
  });
});

/**
 * GAP-FINANCE-PFMS-01 -- release of a signed PFMS batch (POST /v1/finance/pfms/batches/:id/release), real Postgres.
 * Route -> command -> consumer; verify (fail closed) + production gate + maker-checker + exactly-once send.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { withTenantScope } from "@civitasone/db";
import { createDscSigner } from "@civitasone/connector-framework/ports";

const sftp = vi.hoisted(() => ({ calls: 0, fail: false }));
/** Production-deployment switch for the gate (NODE_ENV=production would also change the auth stack under test). */
const deploy = vi.hoisted(() => ({ production: false }));
vi.mock("../src/modules/integrations/sftp-egress.js", () => ({
  uploadBankFile: async () => {
    sftp.calls++;
    await new Promise((r) => setTimeout(r, 60)); // a real upload takes time: widens the race window
    if (sftp.fail) throw new Error("gateway down");
    return "/remote/NACH.txt";
  },
}));
vi.mock("../src/modules/pfms/dsc-client.js", async (orig) => {
  const real = await orig<typeof import("../src/modules/pfms/dsc-client.js")>();
  return {
    ...real,
    isProductionDeployment: () => deploy.production,
    resolveDscSigner: async () => {
      const signer = createDscSigner({ providerKey: "dsc_usb_token_bridge", providerName: "USB token bridge", environment: "sandbox", config: {}, secrets: {} });
      return { signer, providerKey: "dsc_usb_token_bridge", environment: "sandbox" as const, mock: true, signerRef: "slot-1" };
    },
  };
});

import { db } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { financePfms } from "../src/modules/payments/schema.js";
import * as repo from "../src/modules/pfms/repo.js";
import { registerPfmsConsumers } from "../src/modules/pfms/consumer.js";
import { registerPfmsReleaseConsumers } from "../src/modules/pfms/release.js";
import { buildApp } from "../src/app.js";
import { bearer, drain, auditRows } from "./_fp02.js";
import { scoped } from "./_tenant.js";

const INITIATOR = "00000000-0f04-4000-8000-0000000000a1";
const ADMIN = "00000000-0f04-4000-8000-0000000000a2";
const adminH = (t: string, actor = ADMIN, roles = ["finance_admin"]) => bearer(t, actor, roles);

describe("POST /v1/finance/pfms/batches/:id/release", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    registerPfmsConsumers(queue);
    registerPfmsReleaseConsumers(queue);
    await queue.start();
  });
  beforeEach(() => { sftp.calls = 0; sftp.fail = false; deploy.production = false; });

  /** A treasury batch initiated by INITIATOR with one real payment (so there is a beneficiary to put in the file). */
  async function seed(tenant: string, o: { signed?: boolean; createdBy?: string } = {}) {
    const id = randomUUID();
    const pfmsId = `PFMS-${id.slice(0, 8)}`;
    await withTenantScope(db, tenant, async (tx: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      await repo.insertPfmsBatch(tx, {
        id, tenantId: tenant, pfmsId, type: "salary", amountMinor: 125000n, currency: "INR", beneficiaryCount: 1, agencyCode: "AG01", ddoCode: "DDO1",
        submissionStatus: "pending", status: "pending", createdBy: o.createdBy ?? INITIATOR, updatedBy: o.createdBy ?? INITIATOR,
      });
      const headId = randomUUID();
      await tx.execute(sql`INSERT INTO budget.finance_heads (id, tenant_id, code, name, level, classification, created_by, updated_by)
        VALUES (${headId}::uuid, ${tenant}::uuid, ${`H${headId.slice(0, 6)}`}, 'Test head', 1, 'expense', ${INITIATOR}::uuid, ${INITIATOR}::uuid)`);
      const billId = randomUUID();
      await tx.execute(sql`INSERT INTO payments.finance_bills (id, tenant_id, bill_no, vendor_id, head_id, created_by, updated_by)
        VALUES (${billId}::uuid, ${tenant}::uuid, ${`B-${billId.slice(0, 8)}`}, ${randomUUID()}::uuid, ${headId}::uuid, ${INITIATOR}::uuid, ${INITIATOR}::uuid)`);
      await tx.execute(sql`INSERT INTO payments.finance_payments (tenant_id, bill_id, mode, amount_minor, pfms_id, status, ddo_code, created_by, updated_by)
        VALUES (${tenant}::uuid, ${billId}::uuid, 'NEFT', 125000, ${pfmsId}, 'initiated', 'DDO123456', ${INITIATOR}::uuid, ${INITIATOR}::uuid)`);
    });
    if (o.signed !== false) {
      await app.inject({ method: "POST", url: `/v1/finance/pfms/${id}/sign`, headers: bearer(tenant, INITIATOR, ["finance_officer"]), payload: {} });
      await drain();
    }
    return id;
  }
  const row = (tenant: string, id: string) => withTenantScope(db, tenant, async (tx: any) => (await tx.select().from(financePfms).where(eq(financePfms.id, id)))[0]); // eslint-disable-line @typescript-eslint/no-explicit-any
  const release = (tenant: string, id: string, h = adminH(tenant)) => app.inject({ method: "POST", url: `/v1/finance/pfms/batches/${id}/release`, headers: h, payload: {} });
  const publishRelease = (tenant: string, id: string, actor = ADMIN) => queue.publish("finance.pfms.batch_release", {
    messageId: randomUUID(), type: "finance.pfms.batch_release", tenantId: tenant, actorId: actor, correlationId: randomUUID(), schemaVersion: "1.0", payload: { id, tenantId: tenant },
  });

  it("release after sign: verifies, sends once through the NACH/SFTP path, moves signed -> file_sent, audits", async () => {
    const t = randomUUID();
    const id = await seed(t);
    expect((await row(t, id)).submissionStatus).toBe("signed");
    const res = await release(t, id);
    expect(res.statusCode).toBe(202);
    await drain();
    expect(sftp.calls).toBe(1);
    expect((await row(t, id)).submissionStatus).toBe("file_sent");
    const a = await auditRows(t, "release", id);
    expect(a).toHaveLength(1);
    expect(a[0]!.payload).toMatchObject({ outcome: "success", details: { beneficiaryCount: 1, mock: true } });
    expect(await auditRows(t, "release_claimed", id)).toHaveLength(1);
  });

  it("a tampered batch is refused (409 BATCH_CHANGED_AFTER_SIGNING); the consumer refuses it too, even if the route is bypassed", async () => {
    const t = randomUUID();
    const id = await seed(t);
    await scoped(t, (tx) => tx.update(financePfms).set({ amountMinor: 999999n }).where(eq(financePfms.id, id)));
    const res = await release(t, id);
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("BATCH_CHANGED_AFTER_SIGNING");
    await publishRelease(t, id);
    await drain();
    expect(sftp.calls).toBe(0);
    expect((await row(t, id)).submissionStatus).toBe("signed");
    expect((await auditRows(t, "release", id))[0]!.payload).toMatchObject({ outcome: "denied", details: { code: "BATCH_CHANGED_AFTER_SIGNING" } });
  });

  it("a mock signature is refused in production (MOCK_SIGNATURE), route and consumer", async () => {
    const t = randomUUID();
    const id = await seed(t);
    deploy.production = true;
    const res = await release(t, id);
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("MOCK_SIGNATURE");
    await publishRelease(t, id);
    await drain();
    expect(sftp.calls).toBe(0);
    expect((await row(t, id)).submissionStatus).toBe("signed");
  });

  it("self-release is refused with maker-checker on (the default); allowed when the tenant switches it off", async () => {
    const t = randomUUID();
    const id = await seed(t, { createdBy: ADMIN });
    const res = await release(t, id);
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("MAKER_CHECKER_VIOLATION");
    await publishRelease(t, id);
    await drain();
    expect(sftp.calls).toBe(0);
    await scoped(t, (tx) => tx.execute(sql`INSERT INTO gl.finance_settings (tenant_id, maker_checker_enabled, updated_by) VALUES (${t}::uuid, false, ${ADMIN}::uuid)`));
    expect((await release(t, id)).statusCode).toBe(202);
    await drain();
    expect((await row(t, id)).submissionStatus).toBe("file_sent");
  });

  it("concurrent releases send exactly once; the losers are audited as skipped", async () => {
    const t = randomUUID();
    const id = await seed(t);
    await Promise.all([publishRelease(t, id), publishRelease(t, id), publishRelease(t, id), publishRelease(t, id)]);
    await drain();
    expect(sftp.calls).toBe(1);
    expect((await row(t, id)).submissionStatus).toBe("file_sent");
    expect(await auditRows(t, "release", id)).toHaveLength(1);
    expect((await auditRows(t, "release_skipped", id)).length).toBe(3);
  });

  it("re-release of an already-sent batch is accepted, sends nothing, and is audited as a no-op", async () => {
    const t = randomUUID();
    const id = await seed(t);
    await release(t, id); await drain();
    expect(sftp.calls).toBe(1);
    expect((await release(t, id)).statusCode).toBe(202);
    await drain();
    expect(sftp.calls).toBe(1);
    expect(await auditRows(t, "release_skipped", id)).toHaveLength(1);
  });

  it("a failed send reverts the batch to signed (audited), and it can be released again", async () => {
    const t = randomUUID();
    const id = await seed(t);
    sftp.fail = true;
    await release(t, id); await drain();
    expect((await row(t, id)).submissionStatus).toBe("signed");
    expect((await auditRows(t, "release", id))[0]!.payload).toMatchObject({ outcome: "failure", details: { code: "SEND_FAILED", reverted: "signed" } });
    sftp.fail = false;
    await release(t, id); await drain();
    expect((await row(t, id)).submissionStatus).toBe("file_sent");
  });

  it("an unsigned batch is a 409 UNSIGNED_BATCH; only finance_admin / super_admin may release (403 otherwise); unknown id is 404", async () => {
    const t = randomUUID();
    const id = await seed(t, { signed: false });
    const r = await release(t, id);
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("UNSIGNED_BATCH");
    const signed = await seed(t);
    expect((await release(t, signed, adminH(t, ADMIN, ["finance_officer"]))).statusCode).toBe(403);
    expect((await release(t, signed, adminH(t, ADMIN, ["audit_officer"]))).statusCode).toBe(403);
    expect((await release(t, randomUUID())).statusCode).toBe(404);
    expect(sftp.calls).toBe(0);
  });
});

/**
 * PFMS release hardening (review of #1853): TOCTOU, deterministic file, stuck-processing sweeper, resolve, void/re-sign,
 * release-verifier mock check, bank-file gate. Real Postgres; route -> command -> consumer.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { withTenantScope } from "@civitasone/db";
import { createDscSigner } from "@civitasone/connector-framework/ports";

const sftp = vi.hoisted(() => ({ names: [] as string[], fail: false }));
const deploy = vi.hoisted(() => ({ production: false }));
const hook = vi.hoisted(() => ({ calls: 0, onCall: 0, before: null as null | (() => Promise<void>) }));

vi.mock("../src/modules/integrations/sftp-egress.js", () => ({
  uploadBankFile: async (_local: string, remote: string) => {
    sftp.names.push(remote);
    if (sftp.fail) throw new Error("gateway down");
    return `/remote/${remote}`;
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
// Lets a test change a beneficiary at an exact point: before the Nth read of the beneficiary set.
vi.mock("../src/modules/pfms/repo.js", async (orig) => {
  const real = await orig<typeof import("../src/modules/pfms/repo.js")>();
  return {
    ...real,
    listRealBeneficiaries: async (...a: Parameters<typeof real.listRealBeneficiaries>) => {
      hook.calls++;
      if (hook.onCall > 0 && hook.calls === hook.onCall && hook.before) await hook.before();
      return real.listRealBeneficiaries(...a);
    },
  };
});

import { db } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { financePfms } from "../src/modules/payments/schema.js";
import * as repo from "../src/modules/pfms/repo.js";
import { registerPfmsConsumers } from "../src/modules/pfms/consumer.js";
import { registerPfmsReleaseConsumers, sweepStuckReleases } from "../src/modules/pfms/release.js";
import { buildApp } from "../src/app.js";
import { bearer, drain, auditRows } from "./_fp02.js";
import { scoped } from "./_tenant.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { and } from "drizzle-orm";

const INITIATOR = "00000000-0f05-4000-8000-0000000000a1";
const ADMIN = "00000000-0f05-4000-8000-0000000000a2";
const ADMIN2 = "00000000-0f05-4000-8000-0000000000a3";
const adminH = (t: string, actor = ADMIN) => bearer(t, actor, ["finance_admin"]);

describe("PFMS release hardening", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    registerPfmsConsumers(queue);
    registerPfmsReleaseConsumers(queue);
    await queue.start();
  });
  beforeEach(() => { sftp.names = []; sftp.fail = false; deploy.production = false; hook.calls = 0; hook.onCall = 0; hook.before = null; });

  async function seed(tenant: string, o: { signed?: boolean } = {}) {
    const id = randomUUID();
    const pfmsId = `PFMS-${id.slice(0, 8)}`;
    await withTenantScope(db, tenant, async (tx: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      await repo.insertPfmsBatch(tx, {
        id, tenantId: tenant, pfmsId, type: "salary", amountMinor: 125000n, currency: "INR", beneficiaryCount: 1, agencyCode: "AG01", ddoCode: "DDO1",
        submissionStatus: "pending", status: "pending", createdBy: INITIATOR, updatedBy: INITIATOR,
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
    if (o.signed !== false) { await sign(tenant, id); }
    return { id, pfmsId };
  }
  const sign = async (tenant: string, id: string) => {
    await app.inject({ method: "POST", url: `/v1/finance/pfms/${id}/sign`, headers: bearer(tenant, INITIATOR, ["finance_officer"]), payload: {} });
    await drain();
  };
  const row = (tenant: string, id: string) => withTenantScope(db, tenant, async (tx: any) => (await tx.select().from(financePfms).where(eq(financePfms.id, id)))[0]); // eslint-disable-line @typescript-eslint/no-explicit-any
  const release = (tenant: string, id: string, actor = ADMIN) => app.inject({ method: "POST", url: `/v1/finance/pfms/batches/${id}/release`, headers: adminH(tenant, actor), payload: {} });
  const publishRelease = (tenant: string, id: string, actor = ADMIN) => queue.publish("finance.pfms.batch_release", {
    messageId: randomUUID(), type: "finance.pfms.batch_release", tenantId: tenant, actorId: actor, correlationId: randomUUID(), schemaVersion: "1.0", payload: { id, tenantId: tenant },
  });
  const resolve = (tenant: string, id: string, actor: string, body: unknown) => app.inject({ method: "POST", url: `/v1/finance/pfms/batches/${id}/resolve-release`, headers: adminH(tenant, actor), payload: body as object });
  const voidSig = (tenant: string, id: string, actor: string, body: unknown = { reason: "batch changed after signing" }) => app.inject({ method: "POST", url: `/v1/finance/pfms/batches/${id}/void-signature`, headers: adminH(tenant, actor), payload: body as object });
  const findStuckFor = (tenant: string) => async (cutoff: Date) => {
    const rows = await scoped(tenant, (tx) => tx.execute(sql`SELECT id, tenant_id FROM payments.finance_pfms WHERE tenant_id = ${tenant}::uuid AND submission_status = 'processing' AND release_started_at IS NOT NULL AND release_started_at < ${cutoff.toISOString()}::timestamptz`));
    return (rows as unknown as Array<{ id: string; tenant_id: string }>).map((r) => ({ id: r.id, tenantId: r.tenant_id }));
  };
  /** A release that was claimed and then lost (worker died): processing, claimed `minutesAgo` minutes ago by ADMIN. */
  async function stuck(tenant: string, id: string, minutesAgo: number) {
    await withTenantScope(db, tenant, (tx: any) => repo.claimPfmsRelease(tx, id, tenant, ADMIN)); // eslint-disable-line @typescript-eslint/no-explicit-any
    await scoped(tenant, (tx) => tx.execute(sql`UPDATE payments.finance_pfms SET release_started_at = now() - make_interval(mins => ${minutesAgo}) WHERE id = ${id}::uuid`));
  }

  // ── H2 ──
  it("TOCTOU: a beneficiary changed between verification and the send is caught; nothing is sent, the batch reverts to signed", async () => {
    const t = randomUUID();
    const { id, pfmsId } = await seed(t);
    // read 1 = the consumer's verification, read 2 = the post-claim read the file is built from
    hook.calls = 0; hook.onCall = 2;
    hook.before = async () => { await scoped(t, (tx) => tx.execute(sql`UPDATE payments.finance_payments SET amount_minor = amount_minor + 100 WHERE pfms_id = ${pfmsId}`)); };
    await publishRelease(t, id);
    await drain();
    expect(sftp.names).toHaveLength(0);
    const r = await row(t, id);
    expect(r.submissionStatus).toBe("signed");
    expect(r.lastReleaseFailureCode).toBe("BATCH_CHANGED_AFTER_SIGNING");
    expect(r.releaseStartedAt).toBeNull();
    const a = await auditRows(t, "release", id);
    expect(a[0]!.payload).toMatchObject({ outcome: "failure", details: { code: "BATCH_CHANGED_AFTER_SIGNING", reverted: "signed" } });
  });

  // ── H4 + L ──
  it("the release file name is deterministic per batch (a re-release overwrites the same remote file) and dsc_verified_at is set", async () => {
    const t = randomUUID();
    const { id } = await seed(t);
    sftp.fail = true;
    await release(t, id); await drain();               // ambiguous / failed first attempt
    expect((await row(t, id)).lastReleaseFailureCode).toBe("SEND_FAILED");
    sftp.fail = false;
    await release(t, id); await drain();
    expect(sftp.names).toEqual([`NACH_${id}.txt`, `NACH_${id}.txt`]);
    const r = await row(t, id);
    expect(r.submissionStatus).toBe("file_sent");
    expect(r.dscVerifiedAt).toBeInstanceOf(Date);
    expect(r.lastReleaseFailureCode).toBeNull();
  });

  // ── M1 ──
  it("in production a MOCK-* signature is refused by the verifier's verdict even when the stored mock flag says false", async () => {
    const t = randomUUID();
    const { id } = await seed(t);
    await scoped(t, (tx) => tx.update(financePfms).set({ dscMock: false }).where(eq(financePfms.id, id)));
    deploy.production = true;
    const res = await release(t, id);
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("MOCK_SIGNATURE");
    await publishRelease(t, id); await drain();
    expect(sftp.names).toHaveLength(0);
  });

  // ── H1 ──
  it("sweeper: a release stuck in processing beyond the threshold moves to send_unknown with a HIGH audit + alert; it is never re-sent", async () => {
    const t = randomUUID();
    const { id } = await seed(t);
    await stuck(t, id, 120);
    const moved = await sweepStuckReleases({ olderThanMinutes: 30, findStuck: findStuckFor(t) });
    expect(moved).toBe(1);
    const r = await row(t, id);
    expect(r.submissionStatus).toBe("send_unknown");
    expect(sftp.names).toHaveLength(0);
    const a = await auditRows(t, "release_send_unknown", id);
    expect(a).toHaveLength(1);
    expect(a[0]!.payload).toMatchObject({ outcome: "failure", details: { severity: "high", code: "RELEASE_OUTCOME_UNKNOWN" } });
    const alerts = await scoped(t, (tx) => tx.select().from(outboxMessages).where(and(eq(outboxMessages.tenantId, t), eq(outboxMessages.topic, "finance.pfms.release_send_unknown"))));
    expect(alerts).toHaveLength(1);
    // running it again is a no-op, and a release command on it is an audited no-op (no second send)
    expect(await sweepStuckReleases({ olderThanMinutes: 30, findStuck: findStuckFor(t) })).toBe(0);
    await publishRelease(t, id); await drain();
    expect(sftp.names).toHaveLength(0);
    expect((await auditRows(t, "release_skipped", id)).length).toBe(1);
  });

  it("sweeper: a LEGACY processing treasury row (NULL release_started_at, old updated_at) is swept to send_unknown without any backfill", async () => {
    const t = randomUUID();
    const legacy = await seed(t);
    const ekuber = await seed(t);
    await scoped(t, (tx) => tx.execute(sql`UPDATE payments.finance_pfms SET submission_status = 'processing', release_started_at = NULL, released_by = NULL,
      updated_at = now() - interval '3 hours' WHERE id = ${legacy.id}::uuid`));
    await scoped(t, (tx) => tx.execute(sql`UPDATE payments.finance_pfms SET submission_status = 'processing', channel = 'ekuber_adapter', release_started_at = NULL,
      updated_at = now() - interval '3 hours' WHERE id = ${ekuber.id}::uuid`));
    // the finder mirrors findStuckViaScanner's predicate (the scanner role itself is not available under finance_svc)
    const finder = async (cutoff: Date) => {
      const rows = await scoped(t, (tx) => tx.execute(sql`SELECT id, tenant_id FROM payments.finance_pfms WHERE tenant_id = ${t}::uuid AND submission_status = 'processing'
        AND channel = 'treasury_batch' AND COALESCE(release_started_at, updated_at) < ${cutoff.toISOString()}::timestamptz`));
      return (rows as unknown as Array<{ id: string; tenant_id: string }>).map((r) => ({ id: r.id, tenantId: r.tenant_id }));
    };
    expect(await sweepStuckReleases({ olderThanMinutes: 30, findStuck: finder })).toBe(1);
    expect((await row(t, legacy.id)).submissionStatus).toBe("send_unknown");
    expect((await row(t, ekuber.id)).submissionStatus).toBe("processing"); // not a treasury release: left alone
    expect(sftp.names).toHaveLength(0);
    // a LEGACY row that is recent is not swept
    const recent = await seed(t);
    await scoped(t, (tx) => tx.execute(sql`UPDATE payments.finance_pfms SET submission_status = 'processing', release_started_at = NULL, updated_at = now() WHERE id = ${recent.id}::uuid`));
    expect(await sweepStuckReleases({ olderThanMinutes: 30, findStuck: finder })).toBe(0);
  });

  it("sweeper leaves a recent release and every other state alone", async () => {
    const t = randomUUID();
    const recent = await seed(t);
    await stuck(t, recent.id, 5);
    const signedOnly = await seed(t);
    expect(await sweepStuckReleases({ olderThanMinutes: 30, findStuck: findStuckFor(t) })).toBe(0);
    expect((await row(t, recent.id)).submissionStatus).toBe("processing");
    expect((await row(t, signedOnly.id)).submissionStatus).toBe("signed");
  });

  it("resolve: the releaser cannot resolve (403); another admin confirms NOT sent -> signed (and can release again) or SENT -> file_sent; a reason is required", async () => {
    const t = randomUUID();
    const a = await seed(t);
    await stuck(t, a.id, 120);
    await sweepStuckReleases({ olderThanMinutes: 30, findStuck: findStuckFor(t) });
    const self = await resolve(t, a.id, ADMIN, { outcome: "sent", reason: "checked the gateway" });
    expect(self.statusCode).toBe(403);
    expect(self.json().code).toBe("MAKER_CHECKER_VIOLATION");
    expect((await resolve(t, a.id, ADMIN2, { outcome: "sent", reason: "ab" })).statusCode).toBe(400);
    expect((await resolve(t, a.id, ADMIN2, { outcome: "not_sent", reason: "gateway shows no such file" })).statusCode).toBe(202);
    await drain();
    expect((await row(t, a.id)).submissionStatus).toBe("signed");
    const ra = await auditRows(t, "release_resolve", a.id);
    expect(ra[0]!.payload).toMatchObject({ outcome: "success", details: { outcome: "not_sent", to: "signed", reason: "gateway shows no such file" } });
    await release(t, a.id, ADMIN2); await drain();
    expect((await row(t, a.id)).submissionStatus).toBe("file_sent");

    const b = await seed(t);
    await stuck(t, b.id, 120);
    await sweepStuckReleases({ olderThanMinutes: 30, findStuck: findStuckFor(t) });
    expect((await resolve(t, b.id, ADMIN2, { outcome: "sent", reason: "file is on the gateway" })).statusCode).toBe(202);
    await drain();
    expect((await row(t, b.id)).submissionStatus).toBe("file_sent");
    // a batch that is not send_unknown cannot be resolved
    expect((await resolve(t, b.id, ADMIN2, { outcome: "sent", reason: "again please" })).statusCode).toBe(409);
  });

  it("resolve with the tenant maker-checker setting off lets the releaser resolve", async () => {
    const t = randomUUID();
    const a = await seed(t);
    await stuck(t, a.id, 120);
    await sweepStuckReleases({ olderThanMinutes: 30, findStuck: findStuckFor(t) });
    await scoped(t, (tx) => tx.execute(sql`INSERT INTO gl.finance_settings (tenant_id, maker_checker_enabled, updated_by) VALUES (${t}::uuid, false, ${ADMIN}::uuid)`));
    expect((await resolve(t, a.id, ADMIN, { outcome: "not_sent", reason: "confirmed at the gateway" })).statusCode).toBe(202);
    await drain();
    expect((await row(t, a.id)).submissionStatus).toBe("signed");
  });

  // ── M3 ──
  it("void + re-sign: a tampered batch can be recovered; the signer cannot void their own signature; unsigned batches cannot be voided", async () => {
    const t = randomUUID();
    const { id, pfmsId } = await seed(t);
    await scoped(t, (tx) => tx.execute(sql`UPDATE payments.finance_payments SET amount_minor = amount_minor + 5 WHERE pfms_id = ${pfmsId}`));
    expect((await release(t, id)).json().code).toBe("BATCH_CHANGED_AFTER_SIGNING"); // the dead end the review found
    expect((await voidSig(t, id, INITIATOR)).statusCode).toBe(403);                 // INITIATOR signed it
    expect((await voidSig(t, id, ADMIN, { reason: "no" })).statusCode).toBe(400);
    const before = await row(t, id);
    expect((await voidSig(t, id, ADMIN)).statusCode).toBe(202);
    await drain();
    const r = await row(t, id);
    expect(r.submissionStatus).toBe("pending");
    for (const f of ["dscSignature", "batchDigest", "signedInfoHash", "dscCertSerial", "dscXmldsig", "signedAt", "signedBy"] as const) expect(r[f], f).toBeNull();
    const va = await auditRows(t, "signature_void", id);
    expect(va[0]!.payload).toMatchObject({ outcome: "success", details: { voidedCertificateSerial: before.dscCertSerial, voidedBatchDigest: before.batchDigest } });
    await sign(t, id);                                                              // signed again over the changed batch
    const again = await row(t, id);
    expect(again.submissionStatus).toBe("signed");
    expect(again.batchDigest).not.toBe(before.batchDigest);
    expect((await release(t, id, ADMIN2)).statusCode).toBe(202);
    await drain();
    expect((await row(t, id)).submissionStatus).toBe("file_sent");
    // a sent batch can no longer be voided
    expect((await voidSig(t, id, ADMIN)).statusCode).toBe(409);
    const unsigned = await seed(t, { signed: false });
    expect((await voidSig(t, unsigned.id, ADMIN)).statusCode).toBe(409);
  });

  // ── bank file ──
  it("GET bank-file in production is available only for a DSC-signed batch", async () => {
    const t = randomUUID();
    const unsigned = await seed(t, { signed: false });
    const signed = await seed(t);
    const get = (id: string) => app.inject({ method: "GET", url: `/v1/finance/pfms/${id}/bank-file?reason=checking+the+file`, headers: bearer(t, ADMIN, ["finance_admin"]) });
    expect((await get(unsigned.id)).statusCode).toBe(200);          // sandbox: unchanged
    deploy.production = true;
    const u = await get(unsigned.id);
    expect(u.statusCode).toBe(409);
    expect(u.json().code).toBe("UNSIGNED_BATCH");
    expect((await get(signed.id)).statusCode).toBe(200);
  });

  it("list exposes the release bookkeeping (in-flight start, last failure)", async () => {
    const t = randomUUID();
    const { id } = await seed(t);
    sftp.fail = true;
    await release(t, id); await drain();
    const list = (await app.inject({ method: "GET", url: "/v1/finance/pfms/batches", headers: adminH(t) })).json().data;
    expect(list.find((b: { id: string }) => b.id === id).release).toMatchObject({ lastFailureCode: "SEND_FAILED", startedAt: null });
  });
});

/**
 * GAP-FINANCE-PFMS-01 -- DSC-signed PFMS treasury batches.
 *
 * Pure part: canonicalisation is deterministic and unforgeable; the XML-DSig envelope is built from the port's
 * signature; verification fails closed. Real-DB part (real Postgres, RLS, MemoryQueue running the real consumers):
 * sign is idempotent and race-safe, every step is audited, submit verifies the stored signature, a batch changed after
 * signing is refused, and production never releases an unsigned / mock-signed batch.
 */
import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant, withTenantScope } from "@civitasone/db";
import { createDscSigner } from "@civitasone/connector-framework/ports";

const resolver = vi.hoisted(() => ({ env: "sandbox" as "sandbox" | "production", calls: 0 }));
vi.mock("../src/modules/pfms/dsc-client.js", async (orig) => {
  const real = await orig<typeof import("../src/modules/pfms/dsc-client.js")>();
  return {
    ...real,
    resolveDscSigner: async () => {
      resolver.calls++;
      const signer = createDscSigner({ providerKey: "dsc_usb_token_bridge", providerName: "USB token bridge", environment: resolver.env, config: {}, secrets: {} });
      return { signer, providerKey: "dsc_usb_token_bridge", environment: resolver.env, mock: signer.mock, signerRef: "slot-1" };
    },
  };
});

import { db } from "../src/shared/db.js";
import { financePfms } from "../src/modules/payments/schema.js";
import { registerPfmsConsumers, checkBatchSendable } from "../src/modules/pfms/consumer.js";
import * as repo from "../src/modules/pfms/repo.js";
import {
  CANONICAL_VERSION, batchDigestHex, buildSignedInfo, buildXmlDsig, canonicalizeBatch, sha256Hex, verifyStoredSignature,
  type CanonicalBatchHeader, type CanonicalBeneficiary, type StoredSignature,
} from "../src/modules/pfms/dsc-batch.js";
import { auditRows } from "./_fp02.js";

const header: CanonicalBatchHeader = {
  tenantId: "AAAAAAAA-1111-4000-8000-000000000001", pfmsId: "PFMS-100", type: "salary", currency: "INR",
  agencyCode: "AG01", schemeCode: "SCH1", ddoCode: "DDO1", amountMinor: 150000n,
};
const ben = (o: Partial<CanonicalBeneficiary> = {}): CanonicalBeneficiary => ({
  ref: "UTR1", beneficiary: "Asha Rao", account: "123456789012", ifsc: "SBIN0001234", amountMinor: 100000n, ddoCode: "DDO1", ...o,
});

describe("canonicalizeBatch (deterministic, unforgeable)", () => {
  it("golden vector: the layout and its digest are fixed (changing either breaks every stored signature)", () => {
    const c = canonicalizeBatch(header, [ben()]);
    expect(c).toBe([
      "civitas-pfms-batch/v1", "tenant=aaaaaaaa-1111-4000-8000-000000000001", "pfms_id=PFMS-100", "batch_type=salary", "currency=INR",
      "agency=AG01", "scheme=SCH1", "ddo=DDO1", "amount_minor=150000", "beneficiary_count=1",
      "b=UTR1|Asha Rao|123456789012|SBIN0001234|100000|DDO1",
    ].join("\n"));
    expect(batchDigestHex(c)).toBe(sha256Hex(c));
    expect(batchDigestHex(c)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is independent of beneficiary input order and stable across calls", () => {
    const a = ben({ ref: "A" }), b = ben({ ref: "B", amountMinor: 50000n }), c = ben({ ref: "C" });
    const d1 = batchDigestHex(canonicalizeBatch(header, [a, b, c]));
    expect(batchDigestHex(canonicalizeBatch(header, [c, a, b]))).toBe(d1);
    expect(batchDigestHex(canonicalizeBatch(header, [b, c, a]))).toBe(d1);
    for (let i = 0; i < 5; i++) expect(batchDigestHex(canonicalizeBatch(header, [a, b, c]))).toBe(d1);
  });

  it("any material change changes the digest (amount, account, header, count)", () => {
    const base = batchDigestHex(canonicalizeBatch(header, [ben()]));
    expect(batchDigestHex(canonicalizeBatch(header, [ben({ amountMinor: 100001n })]))).not.toBe(base);
    expect(batchDigestHex(canonicalizeBatch(header, [ben({ account: "123456789013" })]))).not.toBe(base);
    expect(batchDigestHex(canonicalizeBatch({ ...header, amountMinor: 150001n }, [ben()]))).not.toBe(base);
    expect(batchDigestHex(canonicalizeBatch(header, [ben(), ben({ ref: "UTR2" })]))).not.toBe(base);
  });

  it("a value cannot forge another field or line (separator / newline escaping)", () => {
    const honest = canonicalizeBatch(header, [ben({ beneficiary: "X", account: "1" })]);
    const forged = canonicalizeBatch(header, [ben({ beneficiary: "X|1" , account: "" })]);
    expect(forged).not.toBe(honest);
    const inj = canonicalizeBatch(header, [ben({ beneficiary: "X\nb=EVIL|||0|" })]);
    expect(inj.split("\n").filter((l) => l.startsWith("b="))).toHaveLength(1);
  });

  it("large paise stay exact (no float)", () => {
    const c = canonicalizeBatch({ ...header, amountMinor: 9007199254740993123n }, []);
    expect(c).toContain("amount_minor=9007199254740993123");
  });
});

describe("XML-DSig envelope is built from the port's signature", () => {
  it("SignedInfo commits to the batch digest; the envelope carries SignatureValue + cert serial", () => {
    const digest = batchDigestHex(canonicalizeBatch(header, [ben()]));
    const si = buildSignedInfo({ digestHex: digest, pfmsId: "PFMS-100" });
    expect(si).toContain(`<DigestValue>${Buffer.from(digest, "hex").toString("base64")}</DigestValue>`);
    expect(si).toContain('URI="#pfms-batch-PFMS-100"');
    expect(buildSignedInfo({ digestHex: digest, pfmsId: "PFMS-100" })).toBe(si);
    const env = buildXmlDsig({ signedInfo: si, signatureBase64: "c2ln", certificateSerial: "SER<1>" });
    expect(env.startsWith('<Signature xmlns="http://www.w3.org/2000/09/xmldsig#">')).toBe(true);
    expect(env).toContain("<SignatureValue>c2ln</SignatureValue>");
    expect(env).toContain("<X509SerialNumber>SER&lt;1&gt;</X509SerialNumber>");
  });
});

describe("verifyStoredSignature (fails closed)", () => {
  const digest = batchDigestHex(canonicalizeBatch(header, [ben()]));
  const hash = sha256Hex(buildSignedInfo({ digestHex: digest, pfmsId: "PFMS-100" }));
  const good: StoredSignature = {
    batchDigest: digest, signedInfoHash: hash, signature: btoa(`MOCK-DSC|slot-1|${hash}|r`), algorithm: "MOCK-SHA256withRSA",
    signatureMethod: null, certSerial: "MOCK-1", signerRef: "slot-1", canonicalVersion: CANONICAL_VERSION,
  };
  it("accepts a good mock signature over the current batch", () => {
    expect(verifyStoredSignature(good, digest, "PFMS-100")).toEqual({ ok: true, method: "mock-structural", mock: true });
  });
  it("rejects missing, changed-batch, tampered, wrong-signer and unknown-algorithm signatures", () => {
    expect(verifyStoredSignature({ ...good, signature: null }, digest, "PFMS-100")).toMatchObject({ ok: false, code: "NOT_SIGNED" });
    expect(verifyStoredSignature(good, "0".repeat(64), "PFMS-100")).toMatchObject({ ok: false, code: "BATCH_CHANGED_AFTER_SIGNING" });
    expect(verifyStoredSignature({ ...good, signedInfoHash: "1".repeat(64) }, digest, "PFMS-100")).toMatchObject({ ok: false, code: "SIGNEDINFO_MISMATCH" });
    expect(verifyStoredSignature({ ...good, signature: btoa(`MOCK-DSC|slot-1|${"2".repeat(64)}|r`) }, digest, "PFMS-100")).toMatchObject({ ok: false, code: "SIGNATURE_INVALID" });
    expect(verifyStoredSignature({ ...good, signerRef: "other" }, digest, "PFMS-100")).toMatchObject({ ok: false, code: "SIGNATURE_INVALID" });
    expect(verifyStoredSignature({ ...good, algorithm: "RSA-SHA256" }, digest, "PFMS-100")).toMatchObject({ ok: false, code: "SIGNATURE_UNVERIFIABLE" });
    expect(verifyStoredSignature({ ...good, canonicalVersion: "v0" }, digest, "PFMS-100")).toMatchObject({ ok: false, code: "UNSUPPORTED_CANONICAL_VERSION" });
  });
});

// ── real DB ─────────────────────────────────────────────────────────────────
const ACTOR = "bb000001-ec00-4000-8000-0000000000aa";

function tenantWrappedQueue(): MemoryQueue {
  const q = new MemoryQueue();
  const rawSubscribe = q.subscribe.bind(q);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (q as any).subscribe = (topic: string, handler: (msg: any) => Promise<void>) =>
    rawSubscribe(topic, (msg: any) => runWithTenant(msg.tenantId, () => handler(msg)));
  return q;
}
const msg = (tenant: string, type: string, payload: Record<string, unknown>, messageId = randomUUID()) =>
  ({ messageId, type, tenantId: tenant, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0", payload: { tenantId: tenant, ...payload } });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function seedBatch(tenant: string, pfmsId = `PFMS-${randomUUID().slice(0, 8)}`, status = "pending"): Promise<string> {
  const id = randomUUID();
  await withTenantScope(db, tenant, (tx: any) => repo.insertPfmsBatch(tx, {
    id, tenantId: tenant, pfmsId, type: "salary", amountMinor: 150000n, currency: "INR", beneficiaryCount: 0,
    agencyCode: "AG01", schemeCode: "SCH1", ddoCode: "DDO1", submissionStatus: status, status: "pending", createdBy: ACTOR, updatedBy: ACTOR,
  }));
  return id;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const readBatch = (tenant: string, id: string) => withTenantScope(db, tenant, async (tx: any) => (await tx.select().from(financePfms).where(eq(financePfms.id, id)))[0]);

describe("DSC signing of a PFMS batch (real Postgres)", () => {
  let q: MemoryQueue;
  beforeAll(async () => { q = tenantWrappedQueue(); registerPfmsConsumers(q); await q.start(); });
  afterEach(() => { resolver.env = "sandbox"; resolver.calls = 0; vi.unstubAllEnvs(); });

  it("sign stores signature, cert serial, signer id, signedAt, the digest and the XML-DSig envelope, labelled mock; audits it", async () => {
    const tenant = randomUUID();
    const id = await seedBatch(tenant);
    await q.publish("finance.pfms.batch_sign", msg(tenant, "finance.pfms.batch_sign", { id }));
    await q.drain();
    const row = await readBatch(tenant, id);
    expect(row.submissionStatus).toBe("signed");
    expect(row.signedBy).toBe(ACTOR);
    expect(row.signedAt).toBeInstanceOf(Date);
    expect(row.dscSignature).toBeTruthy();
    expect(row.dscCertSerial).toMatch(/^MOCK-/);
    expect(row.dscSignerRef).toBe("slot-1");
    expect(row.dscMock).toBe(true);
    expect(row.dscEnvironment).toBe("sandbox");
    expect(row.dscCanonicalVersion).toBe(CANONICAL_VERSION);
    expect(row.batchDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(row.dscXmldsig).toContain(`<SignatureValue>${row.dscSignature}</SignatureValue>`);
    const audits = await auditRows(tenant, "sign", id);
    expect(audits).toHaveLength(1);
    expect(audits[0]!.payload).toMatchObject({ outcome: "success", details: { mock: true, environment: "sandbox", certificateSerial: row.dscCertSerial } });
  });

  it("redelivery of the same message and a second request never sign twice (idempotent)", async () => {
    const tenant = randomUUID();
    const id = await seedBatch(tenant);
    const m1 = msg(tenant, "finance.pfms.batch_sign", { id });
    await q.publish("finance.pfms.batch_sign", m1);
    await q.drain();
    const first = (await readBatch(tenant, id)).dscSignature;
    resolver.calls = 0;
    await q.publish("finance.pfms.batch_sign", m1); // same messageId redelivered
    await q.publish("finance.pfms.batch_sign", msg(tenant, "finance.pfms.batch_sign", { id })); // a fresh request
    await q.drain();
    expect(resolver.calls).toBe(0); // already signed: the signer is not even called
    expect((await readBatch(tenant, id)).dscSignature).toBe(first);
    expect(await auditRows(tenant, "sign", id)).toHaveLength(1);
  });

  it("two concurrent sign requests: exactly one signature persists, the loser is audited as skipped", async () => {
    const tenant = randomUUID();
    const id = await seedBatch(tenant);
    await Promise.all([
      q.publish("finance.pfms.batch_sign", msg(tenant, "finance.pfms.batch_sign", { id })),
      q.publish("finance.pfms.batch_sign", msg(tenant, "finance.pfms.batch_sign", { id })),
      q.publish("finance.pfms.batch_sign", msg(tenant, "finance.pfms.batch_sign", { id })),
    ]);
    await q.drain();
    const row = await readBatch(tenant, id);
    expect(row.submissionStatus).toBe("signed");
    expect(row.version).toBe(2); // one guarded UPDATE applied
    expect(await auditRows(tenant, "sign", id)).toHaveLength(1);
  });

  it("submit verifies the stored signature, then submits; both steps are audited", async () => {
    const tenant = randomUUID();
    const id = await seedBatch(tenant);
    await q.publish("finance.pfms.batch_sign", msg(tenant, "finance.pfms.batch_sign", { id }));
    await q.drain();
    await q.publish("finance.pfms.batch_submit", msg(tenant, "finance.pfms.batch_submit", { id }));
    await q.drain();
    const row = await readBatch(tenant, id);
    expect(row.submissionStatus).toBe("submitted");
    expect(row.dscVerifiedAt).toBeInstanceOf(Date);
    expect(await auditRows(tenant, "verify_signature", id)).toHaveLength(1);
    expect(await auditRows(tenant, "submit", id)).toHaveLength(1);
  });

  it("a batch changed after signing is refused at submit (BATCH_CHANGED_AFTER_SIGNING) and stays signed", async () => {
    const tenant = randomUUID();
    const id = await seedBatch(tenant);
    await q.publish("finance.pfms.batch_sign", msg(tenant, "finance.pfms.batch_sign", { id }));
    await q.drain();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await withTenantScope(db, tenant, (tx: any) => tx.update(financePfms).set({ amountMinor: 999999n }).where(eq(financePfms.id, id)));
    await q.publish("finance.pfms.batch_submit", msg(tenant, "finance.pfms.batch_submit", { id }));
    await q.drain();
    expect((await readBatch(tenant, id)).submissionStatus).toBe("signed");
    const fails = await auditRows(tenant, "submit", id);
    expect(fails).toHaveLength(1);
    expect(fails[0]!.payload).toMatchObject({ outcome: "failure", details: { code: "BATCH_CHANGED_AFTER_SIGNING" } });
  });

  it("an unsigned batch cannot be submitted", async () => {
    const tenant = randomUUID();
    const id = await seedBatch(tenant);
    await q.publish("finance.pfms.batch_submit", msg(tenant, "finance.pfms.batch_submit", { id }));
    await q.drain();
    expect((await readBatch(tenant, id)).submissionStatus).toBe("pending");
    expect((await auditRows(tenant, "submit", id))[0]!.payload).toMatchObject({ outcome: "failure", details: { code: "UNSIGNED_BATCH" } });
  });

  it("production channel not built yet: the stub's NotImplemented is a recorded refusal, the batch stays unsigned", async () => {
    const tenant = randomUUID();
    const id = await seedBatch(tenant);
    resolver.env = "production";
    await q.publish("finance.pfms.batch_sign", msg(tenant, "finance.pfms.batch_sign", { id }));
    await q.drain();
    const row = await readBatch(tenant, id);
    expect(row.submissionStatus).toBe("pending");
    expect(row.dscSignature).toBeNull();
    expect((await auditRows(tenant, "sign", id))[0]!.payload).toMatchObject({ outcome: "failure", details: { code: "DSC_PRODUCTION_UNAVAILABLE" } });
  });

  it("production never releases an unsigned or mock-signed batch", async () => {
    const tenant = randomUUID();
    const unsigned = await seedBatch(tenant);
    const signed = await seedBatch(tenant);
    await q.publish("finance.pfms.batch_sign", msg(tenant, "finance.pfms.batch_sign", { id: signed }));
    await q.drain();
    const u = await readBatch(tenant, unsigned);
    const s = await readBatch(tenant, signed);
    expect(await checkBatchSendable(u)).toMatchObject({ ok: true }); // outside production: sandbox flows unchanged
    vi.stubEnv("NODE_ENV", "production");
    expect(await checkBatchSendable(u)).toMatchObject({ ok: false, code: "UNSIGNED_BATCH" });
    expect(await checkBatchSendable(s)).toMatchObject({ ok: false, code: "MOCK_SIGNATURE" });
  });
});

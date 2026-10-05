/**
 * Scan-link (Finance target) -- REAL-DB tests (GAP-ADMIN-BULK-SCAN-02).
 * Runs against a disposable Postgres where finance migrations are applied and the service role is
 * NOSUPERUSER NOBYPASSRLS (so FORCE RLS is actually enforced). Drives the consumer functions directly and the
 * read/lookup routes through buildApp().inject (real auth plugin, real role gating).
 */
process.env.INTERNAL_SERVICE_SECRET = process.env.INTERNAL_SERVICE_SECRET ?? "scan_link_test_internal_secret_32chars";

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql, eq } from "drizzle-orm";
import { vi } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { scoped } from "./_tenant.js";
import { financeBills, financePayments } from "../src/modules/payments/schema.js";
import { financeJournals } from "../src/modules/gl/schema.js";
import { financeHeads } from "../src/modules/budget/schema.js";
import { financeScannedDocuments as sd } from "../src/modules/scan-link/schema.js";
import { handleLinkRequest, handleUnlinkRequest } from "../src/modules/scan-link/consumer.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { queue } from "../src/shared/infra.js";

const JWT_SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const SERVICE_SECRET = process.env.INTERNAL_SERVICE_SECRET as string;
const TA = randomUUID();
const TB = randomUUID();
const ACTOR = randomUUID();
const APPROVER = randomUUID();
const BIG = 1_234_567_890_123n; // beyond float-safe once multiplied/rounded; must survive end to end

const ids = { billA: randomUUID(), billBig: randomUUID(), payA: randomUUID(), jrnA: randomUUID(), billB: randomUUID() };
let app: FastifyInstance;

/** finance_bills.head_id has a real FK to budget.finance_heads, so every tenant that owns bills needs a head. */
async function seedHead(tenantId: string): Promise<string> {
  const id = randomUUID();
  await scoped(tenantId, (tx) => tx.insert(financeHeads).values({ id, tenantId, code: "5100", name: "Scan-link test head", level: 1, classification: "expenditure", createdBy: ACTOR, updatedBy: ACTOR }));
  return id;
}

function docMeta(documentId = randomUUID()) {
  return {
    documentId, batchId: randomUUID(), fileName: "scan-001.pdf", mimeType: "application/pdf", docType: "bill_voucher",
    pageCount: 2, ocrConfidence: 0.9123, piiFlags: ["pan"], textPreviewMasked: "Bill ****0091 total", filedAt: new Date().toISOString(),
  };
}
function linkMsg(tenantId: string, target: string, targetId: string, hint: { reference: string | null; amountMinor: string | null } | undefined, opts: { messageId?: string; linkId?: string; documentId?: string } = {}) {
  const linkId = opts.linkId ?? randomUUID();
  return {
    linkId,
    msg: {
      messageId: opts.messageId ?? randomUUID(), tenantId, actorId: ACTOR, correlationId: randomUUID(),
      payload: { linkId, target, targetId, document: docMeta(opts.documentId), requestedBy: ACTOR, approvedBy: APPROVER, ...(hint ? { financeHint: hint } : {}) },
    },
  };
}
const rowsFor = (tenantId: string, linkId: string) =>
  scoped(tenantId, (tx) => tx.select().from(sd).where(eq(sd.linkId, linkId)));
const outbox = (tenantId: string, topic: string) =>
  scoped(tenantId, (tx) => tx.select().from(outboxMessages).where(eq(outboxMessages.topic, topic)));
const auditsFor = async (tenantId: string, linkId: string) =>
  (await outbox(tenantId, "audit.event.record")).filter((m) => (m.payload as { metadata?: { linkId?: string } }).metadata?.linkId === linkId);
const resultsFor = async (tenantId: string, topic: string, linkId: string) =>
  (await outbox(tenantId, topic)).filter((m) => (m.payload as { linkId?: string }).linkId === linkId);

const token = (roles: string[], tenantId = TA) => signToken({ sub: ACTOR, tid: tenantId, roles, sid: "scan-link-db" }, JWT_SECRET);
const internal = (tenantId = TA) => ({ "x-internal": "1", "x-tenant-id": tenantId, "x-service-secret": SERVICE_SECRET });

beforeAll(async () => {
  app = await buildApp();
  const headA = await seedHead(TA);
  const headB = await seedHead(TB);
  const common = { createdBy: ACTOR, updatedBy: ACTOR };
  await scoped(TA, async (tx) => {
    await tx.insert(financeBills).values([
      { id: ids.billA, tenantId: TA, billNo: "BILL/2026/0091", vendorId: randomUUID(), headId: headA, grossMinor: 1_250_000n, netMinor: 1_200_000n, ...common },
      { id: ids.billBig, tenantId: TA, billNo: "BIG-1", vendorId: randomUUID(), headId: headA, grossMinor: BIG, netMinor: BIG, ...common },
    ]);
    await tx.insert(financePayments).values({ id: ids.payA, tenantId: TA, billId: ids.billA, mode: "NEFT", amountMinor: 500_050n, eftRef: "EFT-77-2026", utr: "UTR998877", ...common });
    await tx.insert(financeJournals).values({
      id: ids.jrnA, tenantId: TA, voucherNo: "JV-2026-0042", type: "journal", postingDate: "2026-09-01", status: "posted",
      lines: [
        { accountCode: "5100", debitMinor: "300000", creditMinor: "0" },
        { accountCode: "5200", debitMinor: "200000", creditMinor: "0" },
        { accountCode: "2100", debitMinor: "0", creditMinor: "500000" },
      ], ...common,
    });
  });
  await scoped(TB, (tx) => tx.insert(financeBills).values(
    { id: ids.billB, tenantId: TB, billNo: "BILL/2026/0091", vendorId: randomUUID(), headId: headB, grossMinor: 1_250_000n, netMinor: 1_200_000n, ...common }));
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

describe("link request: matching", () => {
  it("exact reference + exact amount links a BILL (gross), stores masked meta, audits, publishes result", async () => {
    const { linkId, msg } = linkMsg(TA, "finance_bill", ids.billA, { reference: "bill 2026 0091", amountMinor: "1250000" });
    const r = await handleLinkRequest(msg);
    expect(r).toMatchObject({ status: "linked", linkId, targetId: ids.billA, reason: null });
    const rows = await rowsFor(TA, linkId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ targetKind: "finance_bill", state: "linked", matchedAmountMinor: 1_250_000n, linkedBy: ACTOR, approvedBy: APPROVER, piiFlags: ["pan"] });
    const audits = await auditsFor(TA, linkId);
    expect(audits).toHaveLength(1);
    expect(audits[0]!.payload).toMatchObject({ service: "finance", action: "scan_link_linked", resourceType: "finance_bill", resourceId: ids.billA, outcome: "success" });
    expect(JSON.stringify(audits[0]!.payload)).not.toContain("0091"); // no reference text in the audit
    expect(await resultsFor(TA, "finance.scan-link.result", linkId)).toHaveLength(1);
  });

  it("maker == checker is rejected MAKER_CHECKER_VIOLATION: no row, failure audit, rejected result; null approver still links", async () => {
    const { linkId, msg } = linkMsg(TA, "finance_bill", ids.billA, { reference: "bill 2026 0091", amountMinor: "1250000" });
    (msg.payload as { approvedBy: string | null }).approvedBy = ACTOR; // requestedBy is ACTOR
    const r = await handleLinkRequest(msg);
    expect(r).toMatchObject({ status: "rejected", reason: "MAKER_CHECKER_VIOLATION" });
    expect(await rowsFor(TA, linkId)).toHaveLength(0);
    const audits = await auditsFor(TA, linkId);
    expect(audits).toHaveLength(1);
    expect(audits[0]!.payload).toMatchObject({ action: "scan_link_rejected", outcome: "failure", metadata: { reason: "MAKER_CHECKER_VIOLATION" } });
    expect(await resultsFor(TA, "finance.scan-link.result", linkId)).toHaveLength(1);
    const off = linkMsg(TA, "finance_bill", ids.billA, { reference: "bill 2026 0091", amountMinor: "1250000" });
    (off.msg.payload as { approvedBy: string | null }).approvedBy = null;
    expect((await handleLinkRequest(off.msg))?.status).toBe("linked");
  });

  it("bill NET amount also counts as the record amount", async () => {
    const { linkId, msg } = linkMsg(TA, "finance_bill", ids.billA, { reference: "BILL/2026/0091", amountMinor: "1200000" });
    expect((await handleLinkRequest(msg))?.status).toBe("linked");
    expect((await rowsFor(TA, linkId))[0]!.matchedAmountMinor).toBe(1_200_000n);
  });

  it("links a PAYMENT by EFT ref and a VOUCHER by voucher no (sum of debits)", async () => {
    const p = linkMsg(TA, "finance_payment", ids.payA, { reference: "eft772026", amountMinor: "500050" });
    expect((await handleLinkRequest(p.msg))?.status).toBe("linked");
    const v = linkMsg(TA, "finance_voucher", ids.jrnA, { reference: "JV 2026 0042", amountMinor: "500000" });
    expect((await handleLinkRequest(v.msg))?.status).toBe("linked");
    expect((await rowsFor(TA, v.linkId))[0]).toMatchObject({ targetKind: "finance_voucher", matchedAmountMinor: 500_000n });
  });

  it("AMOUNT MISMATCH never attaches: flagged_mismatch, zero rows, audit event only, reason has both amounts", async () => {
    const { linkId, msg } = linkMsg(TA, "finance_bill", ids.billA, { reference: "BILL/2026/0091", amountMinor: "1250001" });
    const r = await handleLinkRequest(msg);
    expect(r?.status).toBe("flagged_mismatch");
    expect(r).toMatchObject({ reason: "AMOUNT_MISMATCH", detail: { expectedMinor: "1250000", scannedMinor: "1250001" } });
    expect(await rowsFor(TA, linkId)).toHaveLength(0);
    const audits = await auditsFor(TA, linkId);
    expect(audits).toHaveLength(1);
    expect(audits[0]!.payload).toMatchObject({ action: "scan_link_flagged_mismatch", resourceType: "finance_bill", outcome: "failure" });
    expect((await resultsFor(TA, "finance.scan-link.result", linkId))[0]!.payload).toMatchObject({ status: "flagged_mismatch" });
  });

  it("REFERENCE MISMATCH never attaches (even with an equal amount)", async () => {
    const { linkId, msg } = linkMsg(TA, "finance_bill", ids.billA, { reference: "BILL/2026/9999", amountMinor: "1250000" });
    const r = await handleLinkRequest(msg);
    expect(r?.status).toBe("flagged_mismatch");
    expect(r?.reason).toBe("REFERENCE_MISMATCH");
    expect(JSON.stringify(r)).not.toContain("9999"); // no reference text in the result
    expect(await rowsFor(TA, linkId)).toHaveLength(0);
  });

  it("missing hint never attaches", async () => {
    const { linkId, msg } = linkMsg(TA, "finance_bill", ids.billA, undefined);
    expect(await handleLinkRequest(msg)).toMatchObject({ status: "flagged_mismatch", reason: "MISSING_MATCH_HINT" });
    expect(await rowsFor(TA, linkId)).toHaveLength(0);
  });

  it("paise are bigint: 1,234,567,890,123 links exactly; one paise off is flagged", async () => {
    const ok = linkMsg(TA, "finance_bill", ids.billBig, { reference: "big-1", amountMinor: BIG.toString() });
    expect((await handleLinkRequest(ok.msg))?.status).toBe("linked");
    const stored = await scoped(TA, (tx) => tx.execute(sql`SELECT matched_amount_minor::text AS m FROM payments.finance_scanned_documents WHERE link_id = ${ok.linkId}::uuid`));
    expect((stored as unknown as Array<{ m: string }>)[0]!.m).toBe("1234567890123");
    const off = linkMsg(TA, "finance_bill", ids.billBig, { reference: "big-1", amountMinor: (BIG + 1n).toString() });
    expect((await handleLinkRequest(off.msg))?.status).toBe("flagged_mismatch");
    expect(await rowsFor(TA, off.linkId)).toHaveLength(0);
  });
});

describe("link request: target checks", () => {
  it("missing target -> rejected (no row)", async () => {
    const { linkId, msg } = linkMsg(TA, "finance_bill", randomUUID(), { reference: "X", amountMinor: "1" });
    expect(await handleLinkRequest(msg)).toMatchObject({ status: "rejected", reason: "TARGET_NOT_FOUND" });
    expect(await rowsFor(TA, linkId)).toHaveLength(0);
  });
  it("non-uuid target id and non-finance target kind -> rejected", async () => {
    expect((await handleLinkRequest(linkMsg(TA, "finance_bill", "not-a-uuid", { reference: "X", amountMinor: "1" }).msg))?.status).toBe("rejected");
    expect(await handleLinkRequest(linkMsg(TA, "hr_employee", ids.billA, { reference: "X", amountMinor: "1" }).msg)).toMatchObject({ status: "rejected", reason: "UNSUPPORTED_TARGET" });
  });
  it("CROSS-TENANT: another tenant's bill id is rejected (and nothing is written in either tenant)", async () => {
    // tenant A asks to link tenant B's bill, whose number+amount would otherwise match perfectly
    const { linkId, msg } = linkMsg(TA, "finance_bill", ids.billB, { reference: "BILL/2026/0091", amountMinor: "1250000" });
    const r = await handleLinkRequest(msg);
    expect(r).toMatchObject({ status: "rejected", reason: "TARGET_NOT_FOUND" });
    expect(await rowsFor(TA, linkId)).toHaveLength(0);
    expect(await rowsFor(TB, linkId)).toHaveLength(0);
  });
  it("malformed payload is dropped without writing", async () => {
    const r = await handleLinkRequest({ messageId: randomUUID(), tenantId: TA, actorId: ACTOR, payload: { nope: true } });
    expect(r).toBeNull();
  });
});

describe("idempotency", () => {
  it("same messageId redelivered -> no second row, no second audit, no second result", async () => {
    const { linkId, msg } = linkMsg(TA, "finance_bill", ids.billA, { reference: "BILL/2026/0091", amountMinor: "1250000" });
    expect((await handleLinkRequest(msg))?.status).toBe("linked");
    expect(await handleLinkRequest(msg)).toBeNull();
    expect(await rowsFor(TA, linkId)).toHaveLength(1);
    expect(await auditsFor(TA, linkId)).toHaveLength(1);
    expect(await resultsFor(TA, "finance.scan-link.result", linkId)).toHaveLength(1);
  });
  it("same linkId under a NEW messageId converges: one row, one link audit, result re-emitted as linked", async () => {
    const first = linkMsg(TA, "finance_bill", ids.billA, { reference: "BILL/2026/0091", amountMinor: "1250000" });
    await handleLinkRequest(first.msg);
    const replay = { ...first.msg, messageId: randomUUID() };
    expect((await handleLinkRequest(replay))?.status).toBe("linked");
    expect(await rowsFor(TA, first.linkId)).toHaveLength(1);
    expect(await auditsFor(TA, first.linkId)).toHaveLength(1);
  });
});

describe("unlink", () => {
  async function linked() {
    const l = linkMsg(TA, "finance_bill", ids.billA, { reference: "BILL/2026/0091", amountMinor: "1250000" });
    await handleLinkRequest(l.msg);
    return { linkId: l.linkId, documentId: (l.msg.payload as { document: { documentId: string } }).document.documentId };
  }
  const unlinkMsg = (linkId: string, documentId: string, reason: string, tenantId = TA) => ({
    messageId: randomUUID(), tenantId, actorId: ACTOR, correlationId: randomUUID(),
    payload: { linkId, target: "finance_bill", targetId: ids.billA, documentId, reason, requestedBy: ACTOR },
  });

  it("unlinks with a reason: state, reason, audit and result event", async () => {
    const { linkId, documentId } = await linked();
    const r = await handleUnlinkRequest(unlinkMsg(linkId, documentId, "Wrong bill scanned"));
    expect(r).toMatchObject({ status: "unlinked", linkId });
    expect((await rowsFor(TA, linkId))[0]).toMatchObject({ state: "unlinked", unlinkReason: "Wrong bill scanned", unlinkedBy: ACTOR });
    const audits = (await auditsFor(TA, linkId)).filter((a) => (a.payload as { action: string }).action === "scan_unlinked");
    expect(audits).toHaveLength(1);
    expect(audits[0]!.payload).toMatchObject({ resourceType: "finance_bill", resourceId: ids.billA });
    expect(await resultsFor(TA, "finance.scan-link.unlink.result", linkId)).toHaveLength(1);
  });
  it("PII in the unlink reason (Aadhaar + phone) is stored and audited MASKED; raw digits appear nowhere", async () => {
    const { linkId, documentId } = await linked();
    const raw = "wrong bill, holder aadhaar 2345 6789 0123 phone 9876543210";
    expect((await handleUnlinkRequest(unlinkMsg(linkId, documentId, raw)))?.status).toBe("unlinked");
    const row = (await rowsFor(TA, linkId))[0]!;
    expect(row.state).toBe("unlinked");
    const audit = (await auditsFor(TA, linkId)).find((a) => (a.payload as { action: string }).action === "scan_unlinked")!;
    for (const blob of [row.unlinkReason ?? "", JSON.stringify(audit.payload)]) {
      expect(blob).not.toMatch(/2345\s?6789\s?0123|234567890123|9876543210/);
      expect(blob).toContain("wrong bill");
    }
    const outboxAll = JSON.stringify(await outbox(TA, "finance.scan-link.unlink.result"));
    expect(outboxAll).not.toMatch(/9876543210|234567890123/);
  });
  it("reason shorter than 5 chars is refused (wire schema) and the row stays linked; the table CHECK backs it up", async () => {
    const { linkId, documentId } = await linked();
    expect(await handleUnlinkRequest(unlinkMsg(linkId, documentId, "no"))).toBeNull();
    expect((await rowsFor(TA, linkId))[0]!.state).toBe("linked");
    await expect(scoped(TA, (tx) => tx.execute(sql`UPDATE payments.finance_scanned_documents SET state='unlinked', unlink_reason='x' WHERE link_id=${linkId}::uuid`))).rejects.toThrow();
  });
  it("second unlink converges on unlinked without a second audit; unknown link and other tenant are rejected", async () => {
    const { linkId, documentId } = await linked();
    await handleUnlinkRequest(unlinkMsg(linkId, documentId, "first reason"));
    expect((await handleUnlinkRequest(unlinkMsg(linkId, documentId, "second reason")))?.status).toBe("unlinked");
    expect((await auditsFor(TA, linkId)).filter((a) => (a.payload as { action: string }).action === "scan_unlinked")).toHaveLength(1);
    expect((await handleUnlinkRequest(unlinkMsg(randomUUID(), documentId, "unknown link")))).toMatchObject({ status: "rejected", reason: "LINK_NOT_FOUND" });
    const other = await linked();
    expect((await handleUnlinkRequest(unlinkMsg(other.linkId, other.documentId, "cross tenant try", TB)))?.status).toBe("rejected");
    expect((await rowsFor(TA, other.linkId))[0]!.state).toBe("linked");
  });
});

describe("RLS isolation on finance_scanned_documents", () => {
  it("tenant B sees none of tenant A's rows; no GUC sees none; a cross-tenant insert is refused", async () => {
    const { linkId, msg } = linkMsg(TA, "finance_bill", ids.billA, { reference: "BILL/2026/0091", amountMinor: "1250000" });
    await handleLinkRequest(msg);
    expect(await rowsFor(TB, linkId)).toHaveLength(0);
    expect((await scoped(TB, (tx) => tx.select().from(sd))).every((r) => r.tenantId === TB)).toBe(true);
    const noGuc = await sqlClient`SELECT count(*)::int AS n FROM payments.finance_scanned_documents`;
    expect(noGuc[0]!.n).toBe(0); // fail-closed under NOBYPASSRLS + FORCE RLS
    await expect(scoped(TB, (tx) => tx.insert(sd).values({
      tenantId: TA, targetKind: "finance_bill", targetId: ids.billA, documentId: randomUUID(), batchId: randomUUID(),
      fileName: "x.pdf", docType: "other", linkId: randomUUID(), linkedBy: ACTOR,
    }))).rejects.toThrow();
  });
  it("the role under test really is NOSUPERUSER NOBYPASSRLS and the table is FORCE RLS", async () => {
    const [r] = await sqlClient`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
    expect(r).toMatchObject({ rolsuper: false, rolbypassrls: false });
    const [c] = await sqlClient`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'payments.finance_scanned_documents'::regclass`;
    expect(c).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
  });
});

describe("internal lookup", () => {
  const get = (qs: string, headers: Record<string, string> = internal()) =>
    app.inject({ method: "GET", url: `/internal/v1/scan-link/lookup?${qs}`, headers });

  it("exact reference + exact amount -> confidence 1.0", async () => {
    const res = await get("reference=bill%202026%200091&amountMinor=1250000&kind=bill");
    expect(res.statusCode).toBe(200);
    const [c] = res.json().data;
    expect(c).toMatchObject({ target: "finance_bill", targetId: ids.billA, confidence: 1, amountMinor: "1250000", amountMatches: true });
  });
  it("reference-only (amount differs) -> 0.5 carrying BOTH amounts", async () => {
    const res = await get("reference=BILL/2026/0091&amountMinor=999&kind=finance_bill");
    const [c] = res.json().data;
    expect(c).toMatchObject({ confidence: 0.5, amountMinor: "1250000", requestedAmountMinor: "999", amountMatches: false });
  });
  it("no amount supplied -> reference-only 0.5; voucher and payment kinds work; unknown ref -> empty", async () => {
    expect(((await get("reference=JV-2026-0042&kind=voucher")).json().data[0])).toMatchObject({ target: "finance_voucher", targetId: ids.jrnA, amountMinor: "500000", confidence: 0.5 });
    expect(((await get("reference=EFT-77-2026&amountMinor=500050&kind=payment")).json().data[0])).toMatchObject({ target: "finance_payment", confidence: 1 });
    expect((await get("reference=NOPE-1")).json().data).toEqual([]);
  });
  it("exact big-paise amount (1,234,567,890,123) matches with no float rounding", async () => {
    const [c] = (await get(`reference=BIG-1&amountMinor=${BIG}`)).json().data;
    expect(c).toMatchObject({ confidence: 1, amountMinor: "1234567890123" });
  });
  it("is tenant scoped: tenant B sees only its own bill with the same number", async () => {
    const data = (await get("reference=BILL/2026/0091&kind=bill", internal(TB))).json().data;
    expect(data).toHaveLength(1);
    expect(data[0].targetId).toBe(ids.billB);
  });
  it("rejects a user token (even super_admin), a bad secret and missing reference", async () => {
    expect((await get("reference=BILL/2026/0091", { authorization: `Bearer ${token(["super_admin"])}` })).statusCode).toBe(403);
    expect((await get("reference=BILL/2026/0091", { ...internal(), "x-service-secret": "wrong" })).statusCode).toBe(401);
    expect((await get("amountMinor=5")).statusCode).toBe(400);
  });
  it("returns at most 10 candidates", async () => {
    const t = randomUUID();
    const headT = await seedHead(t);
    await scoped(t, (tx) => tx.insert(financeBills).values(Array.from({ length: 13 }, (_, i) => (
      { tenantId: t, billNo: "DUP" + "-".repeat(i + 1) + "9", vendorId: randomUUID(), headId: headT, grossMinor: 100n, netMinor: 100n, createdBy: ACTOR, updatedBy: ACTOR }))));
    expect((await get("reference=DUP-9&kind=bill", internal(t))).json().data).toHaveLength(10);
  });
});

describe("read routes: role gating + shape", () => {
  const read = (path: string, roles: string[], tenantId = TA) =>
    app.inject({ method: "GET", url: path, headers: { authorization: `Bearer ${token(roles, tenantId)}` } });

  it("bill: reader roles see masked metadata with paise as strings; others get 403", async () => {
    const ok = await read(`/v1/finance/bills/${ids.billBig}/scanned-documents`, ["audit_officer"]);
    expect(ok.statusCode).toBe(200);
    const [d] = ok.json().data;
    expect(d).toMatchObject({ matchedAmountMinor: "1234567890123", docType: "bill_voucher", piiFlags: ["pan"], ocrConfidence: 0.9123 });
    expect(d).not.toHaveProperty("storageKey");
    expect((await read(`/v1/finance/bills/${ids.billBig}/scanned-documents`, ["citizen"])).statusCode).toBe(403);
  });
  it("payment: audit_officer cannot (same as payment detail); finance_officer can", async () => {
    expect((await read(`/v1/finance/payments/${ids.payA}/scanned-documents`, ["audit_officer"])).statusCode).toBe(403);
    const ok = await read(`/v1/finance/payments/${ids.payA}/scanned-documents`, ["finance_officer"]);
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data.length).toBeGreaterThan(0);
  });
  it("voucher route works; unlinked docs are hidden; missing/other-tenant record is 404", async () => {
    expect((await read(`/v1/finance/vouchers/${ids.jrnA}/scanned-documents`, ["finance_admin"])).json().data.length).toBeGreaterThan(0);
    expect((await read(`/v1/finance/bills/${randomUUID()}/scanned-documents`, ["finance_admin"])).statusCode).toBe(404);
    expect((await read(`/v1/finance/bills/${ids.billA}/scanned-documents`, ["finance_admin"], TB)).statusCode).toBe(404);
    expect((await read(`/v1/finance/bills/not-a-uuid/scanned-documents`, ["finance_admin"])).statusCode).toBe(400);
    const listed = (await read(`/v1/finance/bills/${ids.billA}/scanned-documents`, ["finance_admin"])).json().data as Array<{ linkId: string }>;
    const states = await scoped(TA, (tx) => tx.select().from(sd).where(eq(sd.targetId, ids.billA)));
    const unlinkedIds = new Set(states.filter((s) => s.state === "unlinked").map((s) => s.linkId));
    expect(listed.some((l) => unlinkedIds.has(l.linkId))).toBe(false);
  });
  it("no token -> 401", async () => {
    expect((await app.inject({ method: "GET", url: `/v1/finance/bills/${ids.billA}/scanned-documents` })).statusCode).toBe(401);
  });
});

describe("audit-on-read (DPDP)", () => {
  const read = (path: string, roles: string[], tenantId = TA) =>
    app.inject({ method: "GET", url: path, headers: { authorization: `Bearer ${token(roles, tenantId)}` } });
  const viewAudits = (spy: ReturnType<typeof vi.spyOn>) =>
    spy.mock.calls.filter((c) => c[0] === "audit.event.record").map((c) => c[1] as Record<string, unknown> & { payload: Record<string, unknown> });

  it("a successful view publishes exactly one audit event with only actor, document ids, fixed purpose and route", async () => {
    const spy = vi.spyOn(queue, "publish");
    try {
      const res = await read(`/v1/finance/bills/${ids.billBig}/scanned-documents`, ["finance_officer"]);
      expect(res.statusCode).toBe(200);
      const docIds = (res.json().data as Array<{ documentId: string }>).map((d) => d.documentId).sort();
      expect(docIds.length).toBeGreaterThan(0);
      const events = viewAudits(spy);
      expect(events).toHaveLength(1);
      const e = events[0]!;
      expect(e).toMatchObject({ tenantId: TA, actorId: ACTOR });
      expect(e.payload).toEqual({
        service: "finance", action: "view_scanned_documents", resourceType: "finance_bill", resourceId: ids.billBig, outcome: "success",
        details: { purpose: "view_scanned_documents", documentIds: expect.any(Array), route: "/v1/finance/bills/:id/scanned-documents" },
      });
      expect(((e.payload.details as { documentIds: string[] }).documentIds).slice().sort()).toEqual(docIds);
      const text = JSON.stringify(e);
      expect(text).not.toContain("Bill ****0091"); // no preview text
      expect(text).not.toContain("scan-001.pdf");  // no file name
      expect(text).not.toContain("BIG-1");         // no reference
    } finally { spy.mockRestore(); }
  });

  it("payment and voucher views are audited with their own resource type", async () => {
    const spy = vi.spyOn(queue, "publish");
    try {
      await read(`/v1/finance/payments/${ids.payA}/scanned-documents`, ["finance_officer"]);
      await read(`/v1/finance/vouchers/${ids.jrnA}/scanned-documents`, ["finance_admin"]);
      expect(viewAudits(spy).map((e) => e.payload.resourceType)).toEqual(["finance_payment", "finance_voucher"]);
    } finally { spy.mockRestore(); }
  });

  it("403, 404, 400 and 401 emit NO content-view audit", async () => {
    const spy = vi.spyOn(queue, "publish");
    try {
      expect((await read(`/v1/finance/bills/${ids.billBig}/scanned-documents`, ["citizen"])).statusCode).toBe(403);
      expect((await read(`/v1/finance/payments/${ids.payA}/scanned-documents`, ["audit_officer"])).statusCode).toBe(403);
      expect((await read(`/v1/finance/bills/${randomUUID()}/scanned-documents`, ["finance_admin"])).statusCode).toBe(404);
      expect((await read(`/v1/finance/bills/${ids.billA}/scanned-documents`, ["finance_admin"], TB)).statusCode).toBe(404);
      expect((await read(`/v1/finance/bills/nope/scanned-documents`, ["finance_admin"])).statusCode).toBe(400);
      expect((await app.inject({ method: "GET", url: `/v1/finance/bills/${ids.billA}/scanned-documents` })).statusCode).toBe(401);
      expect(viewAudits(spy)).toHaveLength(0);
    } finally { spy.mockRestore(); }
  });

  it("a record with no attachments exposes nothing and emits no audit; a publish failure fails the view (fail-closed)", async () => {
    const t = randomUUID();
    const head = await seedHead(t);
    const billId = randomUUID();
    await scoped(t, (tx) => tx.insert(financeBills).values({ id: billId, tenantId: t, billNo: "EMPTY-1", vendorId: randomUUID(), headId: head, grossMinor: 1n, netMinor: 1n, createdBy: ACTOR, updatedBy: ACTOR }));
    const spy = vi.spyOn(queue, "publish");
    try {
      const res = await read(`/v1/finance/bills/${billId}/scanned-documents`, ["finance_admin"], t);
      expect(res.statusCode).toBe(200);
      expect(res.json().data).toEqual([]);
      expect(viewAudits(spy)).toHaveLength(0);
      spy.mockRejectedValueOnce(new Error("bus down"));
      const failed = await read(`/v1/finance/bills/${ids.billBig}/scanned-documents`, ["finance_officer"]);
      expect(failed.statusCode).toBe(500);
      expect(failed.body).not.toContain("scan-001.pdf");
    } finally { spy.mockRestore(); }
  });
});

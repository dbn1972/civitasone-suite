/**
 * estab scan-link consumer — REAL Postgres (estab migration chain through 0047, estab_svc =
 * NOSUPERUSER NOBYPASSRLS). Covers: link to an open file, closed/missing/cross-tenant
 * rejection, idempotent redelivery, unlink with reason, RLS isolation.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import type { Queue } from "@civitasone/queue";
import { NonRetryableError } from "@civitasone/queue";
import { runWithTenant, withRawTenantGuc } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { estabFiles } from "../src/modules/files/schema.js";
import { fileScannedDocuments } from "../src/modules/scan-link/schema.js";
import { registerScanLinkConsumers, SCAN_LINK_TOPICS } from "../src/modules/scan-link/consumer.js";

const TA = "5ca00001-0000-4000-8000-00000000000a";
const TB = "5ca00001-0000-4000-8000-00000000000b";
const USER = "5ca00001-0000-4000-8000-0000000000a1";
const APPROVER = "5ca00001-0000-4000-8000-0000000000a2";
const BATCH = "5ca00001-0000-4000-8000-0000000000b1";

type Handler = (msg: Record<string, unknown>) => Promise<void>;
const handlers = new Map<string, Handler>();
const fakeQueue = { subscribe: (t: string, h: Handler) => void handlers.set(t, h) } as unknown as Queue;

const messageIds: string[] = [];
async function deliver(topic: string, payload: unknown, o: { tenant?: string; messageId?: string } = {}): Promise<string> {
  const messageId = o.messageId ?? randomUUID();
  messageIds.push(messageId);
  const h = handlers.get(topic);
  if (!h) throw new Error("no handler " + topic);
  await h({ messageId, type: topic, tenantId: o.tenant ?? TA, actorId: USER, correlationId: "corr-scan", schemaVersion: "1.0", payload });
  return messageId;
}

function doc(documentId = randomUUID()) {
  return {
    documentId, batchId: BATCH, fileName: "letter.pdf", mimeType: "application/pdf", docType: "letter",
    pageCount: 3, ocrConfidence: 0.87, piiFlags: ["aadhaar"], textPreviewMasked: "Sub: road works XXXX-XXXX-1234",
    filedAt: "2026-10-01T10:00:00.000Z",
  };
}
function linkReq(targetId: string, o: { linkId?: string; documentId?: string } = {}) {
  const d = doc(o.documentId);
  return { linkId: o.linkId ?? randomUUID(), target: "eoffice_file", targetId, document: d, requestedBy: USER, approvedBy: APPROVER };
}

async function seedFile(tenant: string, status: string, fileNo = "SCAN/" + randomUUID().slice(0, 8), classification = "public"): Promise<string> {
  const id = randomUUID();
  await runWithTenant(tenant, () => db.transaction(async (tx) => {
    await tx.insert(estabFiles).values({
      id, tenantId: tenant, fileNo, subject: "Scan link test file", dept: "EST", currentWith: USER,
      status, classification, createdBy: USER, updatedBy: USER,
    });
  }));
  return id;
}

async function outbox(topic: string, tenant = TA): Promise<Array<{ payload: Record<string, unknown> }>> {
  const rows = await sqlClient`SELECT payload FROM _outbox.messages WHERE tenant_id = ${tenant} AND topic = ${topic} ORDER BY created_at`;
  return rows as unknown as Array<{ payload: Record<string, unknown> }>;
}
const auditFor = async (fileId: string, tenant = TA) =>
  (await outbox("audit.event.record", tenant)).map((r) => r.payload).filter((p) => p.resourceId === fileId);
const resultsFor = async (linkId: string, topic = SCAN_LINK_TOPICS.result) =>
  (await outbox(topic)).map((r) => r.payload).filter((p) => p.linkId === linkId);
const rowsFor = (fileId: string, tenant = TA) =>
  runWithTenant(tenant, () => db.transaction((tx) => tx.select().from(fileScannedDocuments).where(eq(fileScannedDocuments.fileId, fileId))));

beforeAll(() => { registerScanLinkConsumers(fakeQueue); });

afterAll(async () => {
  for (const t of [TA, TB]) {
    await runWithTenant(t, () => db.transaction(async (tx) => {
      await tx.delete(fileScannedDocuments).where(eq(fileScannedDocuments.tenantId, t));
      await tx.delete(estabFiles).where(eq(estabFiles.tenantId, t));
    }));
  }
  await sqlClient`DELETE FROM _outbox.messages WHERE tenant_id IN (${TA}, ${TB})`;
  if (messageIds.length) await sqlClient`DELETE FROM _inbox.processed WHERE message_id IN ${sqlClient(messageIds)}`;
  await sqlClient.end();
});

describe("link request", () => {
  it("links a document to an open (active) file: row + audit on the eFile + linked result", async () => {
    const fileId = await seedFile(TA, "active");
    const req = linkReq(fileId);
    await deliver(SCAN_LINK_TOPICS.request, req);

    const rows = await rowsFor(fileId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      state: "linked", documentId: req.document.documentId, batchId: BATCH, docType: "letter", pageCount: 3,
      piiFlags: ["aadhaar"], linkedBy: USER, approvedBy: APPROVER, linkId: req.linkId, tenantId: TA, version: 1,
    });
    expect(Number(rows[0]!.ocrConfidence)).toBeCloseTo(0.87, 4);

    const audit = await auditFor(fileId);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ service: "estab", action: "attach_scanned_document", resourceType: "file", outcome: "success" });
    expect(JSON.stringify(audit[0])).not.toContain("1234"); // masked preview text never reaches the audit

    const res = await resultsFor(req.linkId);
    expect(res).toEqual([{ linkId: req.linkId, target: "eoffice_file", targetId: fileId, documentId: req.document.documentId, status: "linked", reason: null }]);
  });

  it("also accepts a draft file", async () => {
    const fileId = await seedFile(TA, "draft");
    const req = linkReq(fileId);
    await deliver(SCAN_LINK_TOPICS.request, req);
    expect((await resultsFor(req.linkId))[0]?.status).toBe("linked");
  });

  it.each(["closed", "archived"])("rejects a %s file with FILE_CLOSED and writes no row", async (status) => {
    const fileId = await seedFile(TA, status);
    const req = linkReq(fileId);
    await deliver(SCAN_LINK_TOPICS.request, req);
    expect(await rowsFor(fileId)).toHaveLength(0);
    expect((await resultsFor(req.linkId))[0]).toMatchObject({ status: "rejected", reason: "FILE_CLOSED" });
    expect((await auditFor(fileId))[0]).toMatchObject({ action: "attach_scanned_document_rejected", outcome: "rejected" });
  });

  it.each(["secret", "top_secret"])("refuses a %s file with TARGET_CLASSIFIED, no row, audited, idempotent on redelivery", async (cls) => {
    const fileId = await seedFile(TA, "active", undefined, cls);
    const req = linkReq(fileId);
    const mid = randomUUID();
    await deliver(SCAN_LINK_TOPICS.request, req, { messageId: mid });
    await deliver(SCAN_LINK_TOPICS.request, req, { messageId: mid }); // same message redelivered
    await deliver(SCAN_LINK_TOPICS.request, req); // new messageId, same linkId
    expect(await rowsFor(fileId)).toHaveLength(0);
    const res = await resultsFor(req.linkId);
    expect(res).toHaveLength(2);
    expect(res.every((r) => r.status === "rejected" && r.reason === "TARGET_CLASSIFIED")).toBe(true);
    expect((await auditFor(fileId))[0]).toMatchObject({ action: "attach_scanned_document_rejected", outcome: "rejected" });
  });

  it("maker == checker is rejected MAKER_CHECKER_VIOLATION: no row, audited; a null approver (maker-checker off) still links", async () => {
    const fileId = await seedFile(TA, "active");
    const bad = { ...linkReq(fileId), approvedBy: USER }; // requestedBy is USER
    await deliver(SCAN_LINK_TOPICS.request, bad);
    expect(await rowsFor(fileId)).toHaveLength(0);
    expect((await resultsFor(bad.linkId))[0]).toMatchObject({ status: "rejected", reason: "MAKER_CHECKER_VIOLATION" });
    expect((await auditFor(fileId))[0]).toMatchObject({ action: "attach_scanned_document_rejected", outcome: "rejected" });
    const off = { ...linkReq(fileId), approvedBy: null };
    await deliver(SCAN_LINK_TOPICS.request, off);
    expect(await rowsFor(fileId)).toHaveLength(1);
  });

  it("rejects a missing file with TARGET_NOT_FOUND", async () => {
    const req = linkReq(randomUUID());
    await deliver(SCAN_LINK_TOPICS.request, req);
    expect((await resultsFor(req.linkId))[0]).toMatchObject({ status: "rejected", reason: "TARGET_NOT_FOUND" });
  });

  it("rejects a non-uuid target id and the wrong target kind", async () => {
    const a = { ...linkReq(randomUUID()), targetId: "EST/2026/1" };
    await deliver(SCAN_LINK_TOPICS.request, a);
    expect((await resultsFor(a.linkId))[0]).toMatchObject({ status: "rejected", reason: "TARGET_NOT_FOUND" });
    const b = { ...linkReq(randomUUID()), target: "hr_employee" };
    await deliver(SCAN_LINK_TOPICS.request, b);
    expect((await resultsFor(b.linkId))[0]).toMatchObject({ status: "rejected", reason: "TARGET_KIND_MISMATCH" });
  });

  it("rejects an eFile that belongs to another tenant (no row in either tenant)", async () => {
    const fileB = await seedFile(TB, "active");
    const req = linkReq(fileB);
    await deliver(SCAN_LINK_TOPICS.request, req, { tenant: TA });
    expect((await resultsFor(req.linkId))[0]).toMatchObject({ status: "rejected", reason: "TARGET_NOT_FOUND" });
    expect(await rowsFor(fileB, TB)).toHaveLength(0);
    expect(await rowsFor(fileB, TA)).toHaveLength(0);
  });

  it("is idempotent on redelivery of the same messageId (one row, one audit, one result)", async () => {
    const fileId = await seedFile(TA, "active");
    const req = linkReq(fileId);
    const mid = randomUUID();
    await deliver(SCAN_LINK_TOPICS.request, req, { messageId: mid });
    await deliver(SCAN_LINK_TOPICS.request, req, { messageId: mid });
    expect(await rowsFor(fileId)).toHaveLength(1);
    expect(await auditFor(fileId)).toHaveLength(1);
    expect(await resultsFor(req.linkId)).toHaveLength(1);
  });

  it("is idempotent when the same linkId arrives under a NEW messageId (one row, one audit, linked result re-emitted)", async () => {
    const fileId = await seedFile(TA, "active");
    const req = linkReq(fileId);
    await deliver(SCAN_LINK_TOPICS.request, req);
    await deliver(SCAN_LINK_TOPICS.request, req);
    expect(await rowsFor(fileId)).toHaveLength(1);
    expect(await auditFor(fileId)).toHaveLength(1);
    const res = await resultsFor(req.linkId);
    expect(res).toHaveLength(2);
    expect(res.every((r) => r.status === "linked")).toBe(true);
  });

  it("a retry after the file is closed still reports linked (the link already exists)", async () => {
    const fileId = await seedFile(TA, "active");
    const req = linkReq(fileId);
    await deliver(SCAN_LINK_TOPICS.request, req);
    await runWithTenant(TA, () => db.transaction((tx) => tx.update(estabFiles).set({ status: "closed" }).where(eq(estabFiles.id, fileId))));
    await deliver(SCAN_LINK_TOPICS.request, req);
    expect((await resultsFor(req.linkId)).map((r) => r.status)).toEqual(["linked", "linked"]);
  });

  it("rejects the same document linked twice to one file under different linkIds", async () => {
    const fileId = await seedFile(TA, "active");
    const documentId = randomUUID();
    await deliver(SCAN_LINK_TOPICS.request, linkReq(fileId, { documentId }));
    const second = linkReq(fileId, { documentId });
    await deliver(SCAN_LINK_TOPICS.request, second);
    expect((await resultsFor(second.linkId))[0]).toMatchObject({ status: "rejected", reason: "DOCUMENT_ALREADY_LINKED" });
    expect(await rowsFor(fileId)).toHaveLength(1);
  });

  it("drops a malformed payload as non-retryable", async () => {
    await expect(deliver(SCAN_LINK_TOPICS.request, { linkId: "nope" })).rejects.toBeInstanceOf(NonRetryableError);
  });
});

describe("unlink request", () => {
  async function linked() {
    const fileId = await seedFile(TA, "active");
    const req = linkReq(fileId);
    await deliver(SCAN_LINK_TOPICS.request, req);
    return { fileId, req };
  }
  const unlinkReq = (req: ReturnType<typeof linkReq>, reason = "Filed against the wrong file", over: Record<string, unknown> = {}) => ({
    linkId: req.linkId, target: "eoffice_file", targetId: req.targetId, documentId: req.document.documentId, reason, requestedBy: APPROVER, ...over,
  });

  it("unlinks with a reason: row flips (version+1), audited with the reason, unlinked result", async () => {
    const { fileId, req } = await linked();
    const u = unlinkReq(req);
    await deliver(SCAN_LINK_TOPICS.unlinkRequest, u);
    const [row] = await rowsFor(fileId);
    expect(row).toMatchObject({ state: "unlinked", unlinkReason: "Filed against the wrong file", unlinkedBy: APPROVER, version: 2 });
    expect(row!.unlinkedAt).toBeInstanceOf(Date);
    const audit = (await auditFor(fileId)).find((a) => a.action === "detach_scanned_document");
    expect(audit).toMatchObject({ resourceType: "file", outcome: "success" });
    expect(JSON.stringify(audit)).toContain("Filed against the wrong file");
    expect((await resultsFor(req.linkId, SCAN_LINK_TOPICS.unlinkResult))[0]).toMatchObject({ status: "unlinked", reason: null });
  });

  it("is idempotent: second unlink (new messageId) emits unlinked again with no second audit/version bump", async () => {
    const { fileId, req } = await linked();
    await deliver(SCAN_LINK_TOPICS.unlinkRequest, unlinkReq(req));
    await deliver(SCAN_LINK_TOPICS.unlinkRequest, unlinkReq(req));
    expect((await rowsFor(fileId))[0]!.version).toBe(2);
    expect((await auditFor(fileId)).filter((a) => a.action === "detach_scanned_document")).toHaveLength(1);
    expect((await resultsFor(req.linkId, SCAN_LINK_TOPICS.unlinkResult)).map((r) => r.status)).toEqual(["unlinked", "unlinked"]);
  });

  it("unlinks even when the file has since been closed (corrective action)", async () => {
    const { fileId, req } = await linked();
    await runWithTenant(TA, () => db.transaction((tx) => tx.update(estabFiles).set({ status: "closed" }).where(eq(estabFiles.id, fileId))));
    await deliver(SCAN_LINK_TOPICS.unlinkRequest, unlinkReq(req));
    expect((await rowsFor(fileId))[0]!.state).toBe("unlinked");
  });

  it("rejects an unknown link and a mismatched documentId; row is untouched", async () => {
    const { fileId, req } = await linked();
    const ghost = unlinkReq({ ...req, linkId: randomUUID() });
    await deliver(SCAN_LINK_TOPICS.unlinkRequest, ghost);
    expect((await resultsFor(ghost.linkId, SCAN_LINK_TOPICS.unlinkResult))[0]).toMatchObject({ status: "rejected", reason: "LINK_NOT_FOUND" });
    const wrongDoc = unlinkReq(req, undefined, { documentId: randomUUID() });
    await deliver(SCAN_LINK_TOPICS.unlinkRequest, wrongDoc);
    expect((await rowsFor(fileId))[0]!.state).toBe("linked");
  });

  it("cannot unlink another tenant's link", async () => {
    const { fileId, req } = await linked();
    await deliver(SCAN_LINK_TOPICS.unlinkRequest, unlinkReq(req), { tenant: TB });
    expect((await rowsFor(fileId))[0]!.state).toBe("linked");
  });

  it("scrubs PII from the unlink reason in BOTH the table and the audit payload", async () => {
    const { fileId, req } = await linked();
    const raw = "Wrong person, Aadhaar 2345 6789 0123 and phone 9876543210 pasted by mistake";
    await deliver(SCAN_LINK_TOPICS.unlinkRequest, unlinkReq(req, raw));
    const [row] = await rowsFor(fileId);
    expect(row!.state).toBe("unlinked");
    expect(row!.unlinkReason!.length).toBeGreaterThanOrEqual(5);
    const audit = (await auditFor(fileId)).find((a) => a.action === "detach_scanned_document")!;
    const everything = JSON.stringify([row!.unlinkReason, audit]);
    for (const digits of ["234567890123", "2345 6789 0123", "9876543210"]) expect(everything).not.toContain(digits);
    expect(everything).toContain("Wrong person");
    expect((audit.metadata as { reason: string }).reason).toBe(row!.unlinkReason);
  });

  it("requires a reason of at least 5 chars (contract) and the DB CHECK backs it", async () => {
    const { req } = await linked();
    await expect(deliver(SCAN_LINK_TOPICS.unlinkRequest, unlinkReq(req, "no"))).rejects.toBeInstanceOf(NonRetryableError);
    await expect(
      runWithTenant(TA, () => db.transaction((tx) => tx.execute(sql`UPDATE files.file_scanned_documents SET state='unlinked', unlink_reason='ab' WHERE link_id = ${req.linkId}`))),
    ).rejects.toThrow();
  });
});

describe("RLS isolation on files.file_scanned_documents (FORCE RLS, estab_svc non-bypass)", () => {
  it("is ENABLE+FORCE and the service role is neither superuser nor BYPASSRLS", async () => {
    const [t] = await sqlClient`SELECT relrowsecurity AS en, relforcerowsecurity AS fo FROM pg_class WHERE oid = 'files.file_scanned_documents'::regclass`;
    expect(t).toEqual({ en: true, fo: true });
    const [r] = await sqlClient`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
    expect(r).toEqual({ rolsuper: false, rolbypassrls: false });
  });

  it("a tenant sees only its own rows; no GUC sees none; cross-tenant insert violates WITH CHECK", async () => {
    const fileA = await seedFile(TA, "active");
    await deliver(SCAN_LINK_TOPICS.request, linkReq(fileA));
    const asA = await withRawTenantGuc(sqlClient, TA, (tx) => tx`SELECT count(*)::int AS n FROM files.file_scanned_documents`);
    const asB = await withRawTenantGuc(sqlClient, TB, (tx) => tx`SELECT count(*)::int AS n FROM files.file_scanned_documents WHERE file_id = ${fileA}`);
    expect(asA[0]!.n).toBeGreaterThan(0);
    expect(asB[0]!.n).toBe(0);
    const fileB = await seedFile(TB, "active");
    await expect(
      withRawTenantGuc(sqlClient, TB, (tx) => tx`
        INSERT INTO files.file_scanned_documents (tenant_id, file_id, document_id, batch_id, file_name, doc_type, link_id, linked_by, filed_at, created_by, updated_by)
        VALUES (${TA}, ${fileB}, ${randomUUID()}, ${BATCH}, 'x.pdf', 'letter', ${randomUUID()}, ${USER}, now(), ${USER}, ${USER})`),
    ).rejects.toThrow(/row-level security/i);
    // unique(tenant_id, link_id) is tenant-scoped
    expect(await db.transaction((tx) => tx.select({ n: fileScannedDocuments.id }).from(fileScannedDocuments).where(inArray(fileScannedDocuments.tenantId, [TB])))).toHaveLength(0);
  });
});

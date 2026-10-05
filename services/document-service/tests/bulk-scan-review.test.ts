/**
 * bulk-scan review / filing / link orchestration (real DB, document_svc = NOBYPASSRLS so RLS really applies).
 * Consumers are invoked through an inline queue; outbox rows are inspected directly.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { LINK_TOPICS } from "@civitasone/scan-link";
import { sqlClient } from "../src/shared/db.js";
import { COMMANDS } from "../src/topics.js";
import { setPorts, resetPorts } from "../src/modules/bulk-scan/ports.js";
import { links, fileEvents, batches } from "../src/modules/bulk-scan/schema.js";
import { files, fileVersions } from "../src/modules/files/schema.js";
import { documentIdFor } from "../src/modules/bulk-scan/ids.js";
import { USER1, USER2, USER3, newTenant, send, tenantTx, memoryStore, putSettings, envelope } from "./bulk-scan-helpers.js";
import { newInlineAll, useFiling, seedFile, getFileRow, outboxOf, auditsOf } from "./bulk-scan-review-helpers.js";

const store = memoryStore();
const { q } = newInlineAll();

beforeAll(() => { setPorts({ store }); useFiling(); });
afterEach(() => { store.objects.clear(); });
afterAll(async () => { resetPorts(); await sqlClient.end(); });

const FIN = "11111111-1111-4111-8111-111111111111";
const EMP = "22222222-2222-4222-8222-222222222222";

const approve = (t: string, actor: string, fileId: string, version: number, link?: { target: string; targetId: string }, messageId?: string) =>
  send(q, COMMANDS.bulkReviewApprove, t, actor, { fileId, linkId: messageId ?? randomUUID(), expectedVersion: version, ...(link ? { link } : {}) }, messageId);
const linkRow = async (t: string, id: string) => (await tenantTx(t, (tx) => tx.select().from(links).where(eq(links.id, id))))[0];
const docsOf = (t: string) => tenantTx(t, (tx) => tx.select().from(files).where(eq(files.tenantId, t)));
const versionsOf = (t: string) => tenantTx(t, (tx) => tx.select().from(fileVersions).where(eq(fileVersions.tenantId, t)));

describe("review edit", () => {
  it("rejects a stale expectedVersion (STALE_VERSION) and applies nothing", async () => {
    const t = newTenant();
    const s = await seedFile(store, t);
    await send(q, COMMANDS.bulkReviewEdit, t, USER1, { fileId: s.fileId, expectedVersion: s.version, tags: ["a"] });
    await expect(send(q, COMMANDS.bulkReviewEdit, t, USER2, { fileId: s.fileId, expectedVersion: s.version, tags: ["b"] })).rejects.toThrow(/STALE_VERSION/);
    expect((await getFileRow(t, s.fileId))?.tags).toEqual(["a"]);
    expect((await getFileRow(t, s.fileId))?.version).toBe(s.version + 1);
  });

  it("audits before/after; PII typed by the reviewer is stored and audited masked only", async () => {
    const t = newTenant();
    const s = await seedFile(store, t);
    await send(q, COMMANDS.bulkReviewEdit, t, USER1, {
      fileId: s.fileId, expectedVersion: s.version, docType: "letter",
      fields: [{ kind: "aadhaar", value: "9999 8888 7777" }, { kind: "date", value: "2026-02-03" }],
      text: [{ pageNumber: 1, text: "Corrected text, Aadhaar 9999 8888 7777 end" }],
    });
    const f = await getFileRow(t, s.fileId);
    expect(f?.docType).toBe("letter");
    const stored = (f?.extractedFields ?? []) as { kind: string; value: string }[];
    expect(stored.find((x) => x.kind === "aadhaar")?.value).toBe("XXXXXXXX7777");
    expect(stored.find((x) => x.kind === "date")?.value).toBe("2026-02-03");
    expect(f?.reviewOverrides?.pages?.["1"]).not.toMatch(/9999\s?8888/);                    // re-masked by the tenant policy
    const [ev] = await auditsOf(t, "review_edit");
    const blob = JSON.stringify(ev?.payload);
    expect(blob).not.toMatch(/999988887777|9999 8888|9999/);
    expect(ev?.payload).toMatchObject({ resourceId: s.fileId, oldValue: { docType: "bill_voucher" }, newValue: { docType: "letter" } });
    expect((ev?.payload.newValue as { text: { chars: number }[] }).text[0]?.chars).toBeGreaterThan(0);
  });

  it("refuses edits outside needs_review and unknown doc types / invalid values", async () => {
    const t = newTenant();
    const r = await seedFile(store, t, "ready_to_file");
    await expect(send(q, COMMANDS.bulkReviewEdit, t, USER1, { fileId: r.fileId, expectedVersion: r.version, tags: ["x"] })).rejects.toThrow(/NOT_REVIEWABLE/);
    const s = await seedFile(store, t);
    await expect(send(q, COMMANDS.bulkReviewEdit, t, USER1, { fileId: s.fileId, expectedVersion: s.version, docType: "nope" })).rejects.toThrow(/UNKNOWN_DOC_TYPE/);
    await expect(send(q, COMMANDS.bulkReviewEdit, t, USER1, { fileId: s.fileId, expectedVersion: s.version, fields: [{ kind: "date", value: "31/02/2026" }] })).rejects.toThrow(/INVALID_FIELD_VALUE/);
  });
});

describe("approve without a link -> filing", () => {
  it("files the document: document.files + versions (original, searchable pdf, text, json), folder + tags from the batch, search index event, audit", async () => {
    const t = newTenant();
    const folder = randomUUID();
    const s = await seedFile(store, t, "needs_review", {}, { targetFolderId: folder });
    await approve(t, USER1, s.fileId, s.version);
    const f = await getFileRow(t, s.fileId);
    expect(f?.state).toBe("filed");
    expect(f?.filedDocumentId).toBe(documentIdFor(s.fileId));
    expect(f?.reviewedBy).toBe(USER1);
    expect(f?.searchText).toContain("voucher V-100");
    const [doc] = await docsOf(t);
    expect(doc).toMatchObject({ id: documentIdFor(s.fileId), name: "voucher.pdf", folderId: folder, tags: ["scan"], status: "active" });
    expect((await versionsOf(t)).map((v) => v.kind).sort()).toEqual(["ocr_text", "original", "searchable_pdf", "structured_json"]);
    const idx = await outboxOf(t, "search.index.update");
    expect(idx).toHaveLength(1);
    expect(idx[0]?.payload).toMatchObject({ id: documentIdFor(s.fileId), module: "document", action: "upsert" });
    expect(JSON.stringify(idx[0]?.payload)).not.toMatch(/123412341234/);
    expect(await auditsOf(t, "file_filed")).toHaveLength(1);
    const ev = await tenantTx(t, (tx) => tx.select().from(fileEvents).where(and(eq(fileEvents.fileId, s.fileId), eq(fileEvents.toState, "filed"))));
    expect(ev).toHaveLength(1);
  });

  it("is idempotent under redelivery (same message) and a second approve is refused: still exactly one document", async () => {
    const t = newTenant();
    const s = await seedFile(store, t);
    const id = randomUUID();
    await approve(t, USER1, s.fileId, s.version, undefined, id);
    await approve(t, USER1, s.fileId, s.version, undefined, id);                              // redelivery: markProcessed -> no-op
    await expect(approve(t, USER2, s.fileId, s.version)).rejects.toThrow(/NOT_REVIEWABLE|STALE_VERSION/);
    expect(await docsOf(t)).toHaveLength(1);
    expect(await versionsOf(t)).toHaveLength(4);
    expect(await outboxOf(t, "search.index.update")).toHaveLength(1);
  });

  it("an auto-routed ready_to_file file can be approved straight to filed", async () => {
    const t = newTenant();
    const s = await seedFile(store, t, "ready_to_file");
    await approve(t, USER1, s.fileId, s.version);
    expect((await getFileRow(t, s.fileId))?.state).toBe("filed");
  });

  it("race: two reviewers approving at once -> exactly one wins, one document", async () => {
    const t = newTenant();
    const s = await seedFile(store, t);
    const r = await Promise.allSettled([approve(t, USER1, s.fileId, s.version), approve(t, USER2, s.fileId, s.version)]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(await docsOf(t)).toHaveLength(1);
  });

  it("writes the reviewed text object when the text was edited", async () => {
    const t = newTenant();
    const s = await seedFile(store, t);
    await send(q, COMMANDS.bulkReviewEdit, t, USER1, { fileId: s.fileId, expectedVersion: s.version, text: [{ pageNumber: 1, text: "Reviewed final text" }] });
    const v2 = (await getFileRow(t, s.fileId))?.version ?? 0;
    await approve(t, USER1, s.fileId, v2);
    const f = await getFileRow(t, s.fileId);
    expect(f?.finalTextKey).toBeTruthy();
    expect(store.objects.get(f?.finalTextKey ?? "")?.toString()).toBe("Reviewed final text");
    expect(f?.searchText).toBe("Reviewed final text");
  });
});

describe("reject", () => {
  it("needs_review -> skipped with the reason audited; stale version refused", async () => {
    const t = newTenant();
    const s = await seedFile(store, t);
    await expect(send(q, COMMANDS.bulkReviewReject, t, USER1, { fileId: s.fileId, expectedVersion: s.version + 5, reason: "illegible scan" })).rejects.toThrow(/STALE_VERSION/);
    await send(q, COMMANDS.bulkReviewReject, t, USER1, { fileId: s.fileId, expectedVersion: s.version, reason: "illegible scan" });
    expect((await getFileRow(t, s.fileId))?.state).toBe("skipped");
    expect(await auditsOf(t, "review_rejected")).toHaveLength(1);
    expect(await docsOf(t)).toHaveLength(0);
  });
});

describe("approve with a link", () => {
  it("maker-checker ON (default): link awaiting_approval, file stays ready_to_file, no document and no request yet", async () => {
    const t = newTenant();
    const s = await seedFile(store, t);
    const linkId = randomUUID();
    await approve(t, USER1, s.fileId, s.version, { target: "finance_voucher", targetId: FIN }, linkId);
    expect((await linkRow(t, linkId))?.state).toBe("awaiting_approval");
    expect((await getFileRow(t, s.fileId))?.state).toBe("ready_to_file");
    expect(await docsOf(t)).toHaveLength(0);
    expect(await outboxOf(t, LINK_TOPICS.request("finance"))).toHaveLength(0);
  });

  it("the requester cannot approve their own link; a different user can; the request carries a stable linkId and a finance hint", async () => {
    const t = newTenant();
    const s = await seedFile(store, t);
    const linkId = randomUUID();
    await approve(t, USER1, s.fileId, s.version, { target: "finance_voucher", targetId: FIN }, linkId);
    await expect(send(q, COMMANDS.bulkLinkApprove, t, USER1, { linkId })).rejects.toThrow(/MAKER_CHECKER_VIOLATION/);
    expect((await linkRow(t, linkId))?.state).toBe("awaiting_approval");
    await send(q, COMMANDS.bulkLinkApprove, t, USER2, { linkId });
    const l = await linkRow(t, linkId);
    expect(l).toMatchObject({ state: "requested", approvedBy: USER2, requestedBy: USER1 });
    const reqs = await outboxOf(t, LINK_TOPICS.request("finance"));
    expect(reqs).toHaveLength(1);
    expect(reqs[0]?.payload).toMatchObject({
      linkId, target: "finance_voucher", targetId: FIN, requestedBy: USER1, approvedBy: USER2,
      document: { documentId: documentIdFor(s.fileId), batchId: s.batchId, docType: "bill_voucher", pageCount: 1 },
      financeHint: { reference: "V-100", amountMinor: "150000" },
    });
    expect(JSON.stringify(reqs[0]?.payload)).not.toMatch(/123412341234/);
  });

  it("concurrent approvals of one link by different checkers: exactly one wins, one request published", async () => {
    const t = newTenant();
    const s = await seedFile(store, t);
    const linkId = randomUUID();
    await approve(t, USER1, s.fileId, s.version, { target: "hr_employee", targetId: EMP }, linkId);
    const r = await Promise.allSettled([send(q, COMMANDS.bulkLinkApprove, t, USER2, { linkId }), send(q, COMMANDS.bulkLinkApprove, t, USER3, { linkId })]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(r.filter((x) => x.status === "rejected")).toHaveLength(1);
    expect(await outboxOf(t, LINK_TOPICS.request("hrms"))).toHaveLength(1);
    expect(["requested"]).toContain((await linkRow(t, linkId))?.state);
  });

  it("maker-checker OFF: the request is published at approve time (no second person needed)", async () => {
    const t = newTenant();
    await putSettings(t, { filingMakerChecker: false });
    const s = await seedFile(store, t);
    const linkId = randomUUID();
    await approve(t, USER1, s.fileId, s.version, { target: "eoffice_file", targetId: EMP }, linkId);
    expect((await linkRow(t, linkId))).toMatchObject({ state: "requested", approvedBy: null });
    expect(await outboxOf(t, LINK_TOPICS.request("estab"))).toHaveLength(1);
    expect((await getFileRow(t, s.fileId))?.state).toBe("ready_to_file");
  });

  it("a target disabled for the tenant is refused (LINK_TARGET_NOT_ALLOWED) and creates no link", async () => {
    const t = newTenant();
    await putSettings(t, { allowedLinkTargets: ["hr_employee"] });
    const s = await seedFile(store, t);
    await expect(approve(t, USER1, s.fileId, s.version, { target: "finance_payment", targetId: FIN })).rejects.toThrow(/LINK_TARGET_NOT_ALLOWED/);
    expect(await tenantTx(t, (tx) => tx.select().from(links))).toHaveLength(0);
    expect((await getFileRow(t, s.fileId))?.state).toBe("needs_review");                      // whole tx rolled back
  });

  it("a malformed target id is refused", async () => {
    const t = newTenant();
    const s = await seedFile(store, t);
    await expect(approve(t, USER1, s.fileId, s.version, { target: "hr_employee", targetId: "not-a-uuid" })).rejects.toThrow(/INVALID_LINK_TARGET/);
  });

  it("a checker can reject an awaiting link: file goes back to needs_review with the reason", async () => {
    const t = newTenant();
    const s = await seedFile(store, t);
    const linkId = randomUUID();
    await approve(t, USER1, s.fileId, s.version, { target: "hr_employee", targetId: EMP }, linkId);
    await send(q, COMMANDS.bulkLinkReject, t, USER2, { linkId, reason: "wrong employee" });
    expect((await linkRow(t, linkId))).toMatchObject({ state: "rejected", reason: "wrong employee" });
    const f = await getFileRow(t, s.fileId);
    expect(f?.state).toBe("needs_review");
    expect(f?.reviewReasons).toContain("LINK_REJECTED_BY_APPROVER");
    await expect(send(q, COMMANDS.bulkLinkApprove, t, USER3, { linkId })).rejects.toThrow(/NOT_PENDING/);
  });
});

describe("link results", () => {
  /** approve with a link through to `requested` (maker-checker OFF keeps it short). */
  async function requested(target: "finance_voucher" | "hr_employee" | "eoffice_file" = "finance_voucher") {
    const t = newTenant();
    await putSettings(t, { filingMakerChecker: false });
    const s = await seedFile(store, t);
    const linkId = randomUUID();
    await approve(t, USER1, s.fileId, s.version, { target, targetId: FIN }, linkId);
    const svc = target === "hr_employee" ? "hrms" : target === "eoffice_file" ? "estab" : "finance";
    const result = (status: string, reason: string | null = null, messageId?: string) =>
      send(q, LINK_TOPICS.result(svc), t, USER1, { linkId, target, targetId: FIN, documentId: documentIdFor(s.fileId), status, reason }, messageId);
    return { t, s, linkId, result, svc };
  }

  it("linked: link linked, file filed, document created exactly once (redelivery + duplicate result safe)", async () => {
    const { t, s, linkId, result } = await requested();
    const mid = randomUUID();
    await result("linked", null, mid);
    await result("linked", null, mid);                      // redelivery
    await result("linked");                                 // a second, distinct result message
    expect((await linkRow(t, linkId))?.state).toBe("linked");
    const f = await getFileRow(t, s.fileId);
    expect(f?.state).toBe("filed");
    expect(await docsOf(t)).toHaveLength(1);
    expect(await auditsOf(t, "link_linked")).toHaveLength(1);
    expect(await auditsOf(t, "file_filed")).toHaveLength(1);
  });

  it("rejected (TARGET_CLASSIFIED): link rejected with the reason, file back to needs_review, no document", async () => {
    const { t, s, linkId, result } = await requested("eoffice_file");
    await result("rejected", "TARGET_CLASSIFIED");
    expect((await linkRow(t, linkId))).toMatchObject({ state: "rejected", resultReason: "TARGET_CLASSIFIED" });
    const f = await getFileRow(t, s.fileId);
    expect(f?.state).toBe("needs_review");
    expect(f?.reviewReasons).toContain("LINK_TARGET_CLASSIFIED");
    expect(await docsOf(t)).toHaveLength(0);
    expect(await auditsOf(t, "link_target_rejected")).toHaveLength(1);
    expect(await auditsOf(t, "file_returned_to_review")).toHaveLength(1);
  });

  it("flagged_mismatch: link flagged, file back to needs_review, never filed; the reviewer can reject the flag then try another target", async () => {
    const { t, s, linkId, result } = await requested();
    await result("flagged_mismatch", "AMOUNT_MISMATCH");
    expect((await linkRow(t, linkId))?.state).toBe("flagged_mismatch");
    const f = await getFileRow(t, s.fileId);
    expect(f?.state).toBe("needs_review");
    expect(f?.reviewReasons).toContain("LINK_AMOUNT_MISMATCH");
    await send(q, COMMANDS.bulkLinkReject, t, USER2, { linkId, reason: "different bill" });
    expect((await linkRow(t, linkId))?.state).toBe("rejected");
    const f2 = await getFileRow(t, s.fileId);
    await approve(t, USER1, s.fileId, f2?.version ?? 0, { target: "finance_bill", targetId: EMP });   // new target is accepted
  });

  it("a result for a link that is no longer awaiting one is ignored (late / duplicate)", async () => {
    const { t, s, linkId, result } = await requested();
    await result("rejected", "TARGET_NOT_FOUND");
    await result("linked");                                 // late contradictory result: must not file
    expect((await linkRow(t, linkId))?.state).toBe("rejected");
    expect((await getFileRow(t, s.fileId))?.state).toBe("needs_review");
    expect(await docsOf(t)).toHaveLength(0);
  });

  it("linked but the file can no longer be filed (batch cancelled meanwhile): the link is taken straight back (unlink request)", async () => {
    const { t, s, linkId, result, svc } = await requested();
    await send(q, COMMANDS.bulkBatchCancel, t, USER1, { batchId: s.batchId });
    expect((await getFileRow(t, s.fileId))?.state).toBe("cancelled");
    await result("linked");
    expect((await linkRow(t, linkId))?.state).toBe("unlink_requested");
    expect(await docsOf(t)).toHaveLength(0);
    expect(await outboxOf(t, LINK_TOPICS.unlinkRequest(svc as "finance"))).toHaveLength(1);
  });

  it("an invalid result payload is a permanent failure", async () => {
    const t = newTenant();
    await expect(send(q, LINK_TOPICS.result("hrms"), t, USER1, { nope: true })).rejects.toThrow(/INVALID_LINK_RESULT/);
  });
});

describe("unlink flow", () => {
  async function linked() {
    const t = newTenant();
    await putSettings(t, { filingMakerChecker: false });
    const s = await seedFile(store, t);
    const linkId = randomUUID();
    await approve(t, USER1, s.fileId, s.version, { target: "hr_employee", targetId: EMP }, linkId);
    await send(q, LINK_TOPICS.result("hrms"), t, USER1, { linkId, target: "hr_employee", targetId: EMP, documentId: documentIdFor(s.fileId), status: "linked", reason: null });
    return { t, s, linkId };
  }

  it("unlink request (reason >= 5) -> unlink_requested + request published; result unlinked -> unlinked", async () => {
    const { t, s, linkId } = await linked();
    await expect(send(q, COMMANDS.bulkLinkUnlink, t, USER1, { linkId, reason: "no" })).rejects.toThrow(/INVALID_PAYLOAD/);
    await send(q, COMMANDS.bulkLinkUnlink, t, USER2, { linkId, reason: "attached to wrong employee" });
    expect((await linkRow(t, linkId))).toMatchObject({ state: "unlink_requested", reason: "attached to wrong employee" });
    const reqs = await outboxOf(t, LINK_TOPICS.unlinkRequest("hrms"));
    expect(reqs).toHaveLength(1);
    expect(reqs[0]?.payload).toMatchObject({ linkId, target: "hr_employee", documentId: documentIdFor(s.fileId), requestedBy: USER2, reason: "attached to wrong employee" });
    const mid = randomUUID();
    await send(q, LINK_TOPICS.unlinkResult("hrms"), t, USER2, { linkId, documentId: documentIdFor(s.fileId), status: "unlinked", reason: null }, mid);
    await send(q, LINK_TOPICS.unlinkResult("hrms"), t, USER2, { linkId, documentId: documentIdFor(s.fileId), status: "unlinked", reason: null }, mid);   // redelivery
    expect((await linkRow(t, linkId))?.state).toBe("unlinked");
    expect(await auditsOf(t, "link_unlinked")).toHaveLength(1);
    expect((await getFileRow(t, s.fileId))?.state).toBe("filed");                              // the document itself stays filed
  });

  it("a refused unlink leaves the link in force; unlinking an unlinked link is refused", async () => {
    const { t, s, linkId } = await linked();
    await send(q, COMMANDS.bulkLinkUnlink, t, USER2, { linkId, reason: "attached to wrong employee" });
    await send(q, LINK_TOPICS.unlinkResult("hrms"), t, USER2, { linkId, documentId: documentIdFor(s.fileId), status: "rejected", reason: "LINK_NOT_FOUND" });
    expect((await linkRow(t, linkId))).toMatchObject({ state: "linked", resultReason: "LINK_NOT_FOUND" });
    await expect(send(q, COMMANDS.bulkLinkUnlink, t, USER2, { linkId: randomUUID(), reason: "attached to wrong employee" })).rejects.toThrow(/LINK_NOT_FOUND/);
  });
});

describe("batch-complete notification", () => {
  it("is sent to the uploader exactly once per completion cycle (redelivery + repeated completion events)", async () => {
    const t = newTenant();
    const s = await seedFile(store, t, "needs_review", {}, { createdBy: USER3 });
    await tenantTx(t, (tx) => tx.update(batches).set({ status: "completed", completedAt: new Date("2026-10-04T10:00:00Z"), fileCount: 1 }).where(eq(batches.id, s.batchId)).then(() => undefined));
    const mid = randomUUID();
    const topic = "document.bulkscan.batch.completed";
    await send(q, topic, t, USER1, { batchId: s.batchId }, mid);
    await send(q, topic, t, USER1, { batchId: s.batchId }, mid);                // redelivery
    await send(q, topic, t, USER1, { batchId: s.batchId });                     // another event, same cycle
    const n = await outboxOf(t, "notification.send");
    expect(n).toHaveLength(1);
    expect(n[0]?.payload).toMatchObject({ recipient: USER3, recipientId: USER3, channel: "in_app", eventType: "bulk_scan.batch.completed", variables: { total: "1", needsReview: "1", filed: "0", allSettled: "false" } });
    // a re-opened + re-completed batch is a new cycle
    await tenantTx(t, (tx) => tx.update(batches).set({ completedAt: new Date("2026-10-04T11:00:00Z") }).where(eq(batches.id, s.batchId)).then(() => undefined));
    await send(q, topic, t, USER1, { batchId: s.batchId });
    expect(await outboxOf(t, "notification.send")).toHaveLength(2);
  });

  it("does not notify for a batch that is not completed", async () => {
    const t = newTenant();
    const s = await seedFile(store, t);
    await send(q, "document.bulkscan.batch.completed", t, USER1, { batchId: s.batchId });
    expect(await outboxOf(t, "notification.send")).toHaveLength(0);
  });
});

describe("RLS isolation + FORCE RLS", () => {
  it("tenant B cannot see or move tenant A's links / files", async () => {
    const a = newTenant(), b = newTenant();
    const s = await seedFile(store, a);
    const linkId = randomUUID();
    await approve(a, USER1, s.fileId, s.version, { target: "hr_employee", targetId: EMP }, linkId);
    expect(await tenantTx(b, (tx) => tx.select().from(links))).toHaveLength(0);
    await expect(send(q, COMMANDS.bulkLinkApprove, b, USER2, { linkId })).rejects.toThrow(/LINK_NOT_FOUND/);
    await expect(send(q, COMMANDS.bulkReviewReject, b, USER2, { fileId: s.fileId, expectedVersion: s.version, reason: "cross tenant" })).rejects.toThrow(/FILE_NOT_FOUND/);
    expect((await getFileRow(a, s.fileId))?.state).toBe("ready_to_file");
  });

  it("every bulk_scan table (and document.files / file_versions) has FORCE ROW LEVEL SECURITY", async () => {
    const rows = await sqlClient<{ relname: string; relforcerowsecurity: boolean }[]>`
      SELECT c.relname, c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = 'r' AND ((n.nspname = 'bulk_scan') OR (n.nspname = 'document' AND c.relname IN ('files', 'file_versions')))`;
    expect(rows.length).toBeGreaterThanOrEqual(9);
    for (const r of rows) expect(r.relforcerowsecurity, r.relname).toBe(true);
  });

  it("the document filed for tenant A is invisible to tenant B", async () => {
    const a = newTenant(), b = newTenant();
    const s = await seedFile(store, a);
    await approve(a, USER1, s.fileId, s.version);
    expect(await docsOf(b)).toHaveLength(0);
    expect(await docsOf(a)).toHaveLength(1);
  });
});

describe("FilingPort adapter", () => {
  it("create() is idempotent (second call = false, nothing duplicated); markDeleted() is idempotent too", async () => {
    const t = newTenant();
    const { createFilingAdapter } = await import("../src/modules/files/filing-adapter.js");
    const port = createFilingAdapter();
    const input = {
      tenantId: t, documentId: randomUUID(), actorId: USER1, folderId: null, name: "x.pdf", mimeType: "application/pdf", sizeBytes: 5, tags: ["a"],
      originalKey: "k/orig", searchablePdfKey: "k/pdf", textKey: "k/txt", structuredJsonKey: null,
    };
    expect(await tenantTx(t, (tx) => port.create(tx, input))).toBe(true);
    expect(await tenantTx(t, (tx) => port.create(tx, input))).toBe(false);
    expect(await docsOf(t)).toHaveLength(1);
    expect((await versionsOf(t)).map((v) => v.kind).sort()).toEqual(["ocr_text", "original", "searchable_pdf"]);
    expect(await tenantTx(t, (tx) => port.markDeleted(tx, { tenantId: t, documentId: input.documentId, actorId: USER1 }))).toBe(true);
    expect(await tenantTx(t, (tx) => port.markDeleted(tx, { tenantId: t, documentId: input.documentId, actorId: USER1 }))).toBe(false);
    expect((await docsOf(t))[0]?.status).toBe("deleted");
  });

  it("without an injected filing port, approve fails loudly (never silently files nothing)", async () => {
    const t = newTenant();
    const s = await seedFile(store, t);
    setPorts({ filing: { create: () => { throw new Error("FILING_PORT_NOT_CONFIGURED"); }, markDeleted: () => { throw new Error("x"); } } });
    try {
      await expect(approve(t, USER1, s.fileId, s.version)).rejects.toThrow(/FILING_PORT_NOT_CONFIGURED/);
      expect((await getFileRow(t, s.fileId))?.state).toBe("needs_review");                     // whole tx rolled back
    } finally { useFiling(); }
  });
});

describe("envelope helper sanity", () => {
  it("builds an envelope", () => { expect(envelope("x", "t", "a", {}).tenantId).toBe("t"); });
});

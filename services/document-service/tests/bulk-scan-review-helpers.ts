/** Helpers for the review / filing / link / retention tests (real DB, inline queue, fake object store + filing port). */
import { randomUUID } from "node:crypto";
import { and, eq, asc } from "drizzle-orm";
import { outboxMessages } from "@civitasone/outbox";
import type { Queue } from "@civitasone/queue";
import { db } from "../src/shared/db.js";
import { registerBulkScanConsumers } from "../src/modules/bulk-scan/consumer.js";
import { registerReviewConsumers } from "../src/modules/bulk-scan/review-consumer.js";
import { registerLinkResultConsumers } from "../src/modules/bulk-scan/link-consumer.js";
import { registerNotifyConsumers } from "../src/modules/bulk-scan/notify-consumer.js";
import { createFilingAdapter } from "../src/modules/files/filing-adapter.js";
import { keys } from "../src/modules/bulk-scan/keys.js";
import { setPorts } from "../src/modules/bulk-scan/ports.js";
import { batchFiles } from "../src/modules/bulk-scan/schema.js";
import { InlineQueue, USER1, insertBatchRow, insertFileRow, tenantTx, type MemStore } from "./bulk-scan-helpers.js";

export function newInlineAll(): { q: InlineQueue; as: Queue } {
  const q = new InlineQueue();
  const as = q as unknown as Queue;
  registerBulkScanConsumers(as);
  registerReviewConsumers(as);
  registerLinkResultConsumers(as);
  registerNotifyConsumers(as);
  return { q, as };
}

export const useFiling = (): void => setPorts({ filing: createFilingAdapter() });

export interface Seeded { tenantId: string; batchId: string; fileId: string; version: number }

export const SJ = (text = "Dear Sir, voucher V-100 dated 2026-01-02 Aadhaar XXXX XXXX 1234"): Record<string, unknown> => ({
  schemaVersion: 1, pageCount: 1, meanConfidence: 0.9, providerIds: ["tesseract"], classification: null, fields: [],
  pii: { detected: true, types: ["aadhaar"], countsByType: { aadhaar: 1 }, actions: { aadhaar: "mask" } }, metadata: {},
  pages: [{
    pageNumber: 1, text, meanConfidence: 0.9, orientationDeg: 0, script: "Latin", providerId: "tesseract", source: "ocr",
    blocks: [{ text, confidence: 0.9, bbox: { x0: 0, y0: 0, x1: 300, y1: 40 }, lines: [{ text, confidence: 0.9, bbox: { x0: 0, y0: 0, x1: 300, y1: 20 }, words: [
      { text: "Dear", confidence: 0.95, bbox: { x0: 0, y0: 0, x1: 40, y1: 20 } }, { text: "Sir", confidence: 0.9, bbox: { x0: 45, y0: 0, x1: 70, y1: 20 } },
    ] }] }],
  }],
});

export const FIELDS = [
  { kind: "voucher_no", value: "V-100", raw: "V-100", confidence: 0.9, pageNumber: 1, bbox: null },
  { kind: "amount_inr", value: "150000", raw: "1,500.00", confidence: 0.9, pageNumber: 1, bbox: null },
  { kind: "aadhaar", value: "123412341234", raw: "XXXX XXXX 1234", confidence: 0.9, pageNumber: 1, bbox: null },
];

/** A batch + one file already through OCR: stored derivatives in the fake store, row in `state` (default needs_review). */
export async function seedFile(
  store: MemStore, tenantId: string, state: "needs_review" | "ready_to_file" = "needs_review",
  over: Partial<typeof batchFiles.$inferInsert> = {}, batchOver: { createdBy?: string; targetFolderId?: string } = {},
): Promise<Seeded> {
  const batchId = await insertBatchRow(tenantId, { createdBy: batchOver.createdBy ?? USER1, updatedBy: batchOver.createdBy ?? USER1, targetFolderId: batchOver.targetFolderId ?? null, defaultTags: ["scan"] });
  const fileId = randomUUID();
  const text = "Dear Sir, voucher V-100 dated 2026-01-02 Aadhaar XXXX XXXX 1234";
  const kText = keys.textMasked(tenantId, batchId, fileId), kJson = keys.structuredJson(tenantId, batchId, fileId), kPdf = keys.searchablePdf(tenantId, batchId, fileId);
  store.objects.set(keys.original(tenantId, batchId, fileId), Buffer.from("ORIGINAL"));
  store.objects.set(kText, Buffer.from(text));
  store.objects.set(kJson, Buffer.from(JSON.stringify(SJ(text))));
  store.objects.set(kPdf, Buffer.from("%PDF-searchable"));
  store.objects.set(keys.pageImage(tenantId, batchId, fileId, 1), Buffer.from("PNG"));
  await insertFileRow(tenantId, batchId, state, {
    id: fileId, originalName: "voucher.pdf", mimeType: "application/pdf", pageCount: 1, ocrMeanConfidence: "0.9000", docType: "bill_voucher",
    classification: { docType: "bill_voucher", confidence: 0.8, evidence: ["kw:voucher"], uncertain: false, presetDocType: "letter", candidates: [{ docType: "bill_voucher", score: 0.8 }, { docType: "letter", score: 0.3 }, { docType: "other", score: 0.1 }] },
    extractedFields: FIELDS, piiFlags: ["aadhaar"], reviewReasons: state === "needs_review" ? ["PII_DETECTED"] : [],
    piiFindings: [{ type: "aadhaar", pageNumber: 1, start: 52, end: 66, bbox: null, action: "mask", maskedPreview: "XXXX XXXX 1234" }],
    degradedPages: [{ pageNumber: 1, reason: "no font", droppedScripts: ["Tamil"] }], pageImageCount: 1,
    textMaskedKey: kText, structuredJsonKey: kJson, searchablePdfKey: kPdf, tags: ["scan"], ...over,
  });
  const f = await tenantTx(tenantId, (tx) => tx.select().from(batchFiles).where(eq(batchFiles.id, fileId)));
  return { tenantId, batchId, fileId, version: f[0]?.version ?? 1 };
}

export const getFileRow = async (tenantId: string, fileId: string) =>
  (await tenantTx(tenantId, (tx) => tx.select().from(batchFiles).where(and(eq(batchFiles.id, fileId), eq(batchFiles.tenantId, tenantId)))))[0];

/** Outbox rows (published or not) of a topic for a tenant, oldest first. */
export async function outboxOf(tenantId: string, topic: string): Promise<{ id: string; payload: Record<string, unknown>; actorId: string }[]> {
  const rows = await db.select().from(outboxMessages).where(and(eq(outboxMessages.tenantId, tenantId), eq(outboxMessages.topic, topic))).orderBy(asc(outboxMessages.createdAt));
  return rows.map((r) => ({ id: r.id, payload: r.payload, actorId: r.actorId }));
}

export const auditsOf = async (tenantId: string, action?: string) =>
  (await outboxOf(tenantId, "audit.event.record")).filter((r) => !action || r.payload.action === action);

// ── filed-document fixtures + fake target servers ───────────────

import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { insertBatchRow as _ib } from "./bulk-scan-helpers.js";
import { links as linksTable } from "../src/modules/bulk-scan/schema.js";
import { documentIdFor } from "../src/modules/bulk-scan/ids.js";

void _ib;

/** A FILED document (state filed + document id + masked snippet), optionally with an ACTIVE link of `link` target. */
export async function seedFiled(
  store: MemStore, tenantId: string,
  o: { link?: string; linkState?: string; searchText?: string; docType?: string; name?: string; purged?: boolean; pageImages?: number } = {},
): Promise<Seeded & { documentId: string }> {
  const s = await seedFile(store, tenantId, "ready_to_file", {
    docType: o.docType ?? "bill_voucher", originalName: o.name ?? "voucher.pdf", pageImageCount: o.pageImages ?? 1,
  });
  const documentId = documentIdFor(s.fileId);
  await tenantTx(tenantId, (tx) => tx.update(batchFiles).set({
    state: "filed", filedDocumentId: documentId, filedAt: new Date("2026-09-01T00:00:00Z"),
    searchText: o.searchText ?? "Voucher V-100 payment for road repair XXXX XXXX 1234",
    ...(o.purged ? { retentionDeletedAt: new Date() } : {}),
  }).where(eq(batchFiles.id, s.fileId)).then(() => undefined));
  // the document itself (as the real filing step would have created it)
  const row = await getFileRow(tenantId, s.fileId);
  await tenantTx(tenantId, (tx) => createFilingAdapter().create(tx, {
    tenantId, documentId, actorId: USER1, folderId: null, name: row?.originalName ?? "x", mimeType: row?.mimeType ?? null, sizeBytes: row?.sizeBytes ?? null, tags: row?.tags ?? [],
    originalKey: row?.storageKey ?? "", searchablePdfKey: row?.searchablePdfKey ?? null, textKey: row?.textMaskedKey ?? null, structuredJsonKey: row?.structuredJsonKey ?? null,
  }).then(() => undefined));
  if (o.link) {
    await tenantTx(tenantId, (tx) => tx.insert(linksTable).values({
      id: randomUUID(), tenantId, fileId: s.fileId, documentId, target: o.link as string, targetId: "33333333-3333-4333-8333-333333333333",
      state: o.linkState ?? "linked", requestedBy: USER1,
    }).then(() => undefined));
  }
  return { ...s, documentId };
}

export interface FakeServer { url: string; hits: { url: string; headers: IncomingMessage["headers"] }[]; close(): Promise<void> }

/** A tiny local HTTP server standing in for a target service (the real http stack, no mocking of fetch). */
export async function fakeServer(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<FakeServer> {
  const hits: FakeServer["hits"] = [];
  const srv: Server = createServer((req, res) => { hits.push({ url: req.url ?? "", headers: req.headers }); handler(req, res); });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const port = (srv.address() as AddressInfo).port;
  return { url: `http://127.0.0.1:${port}`, hits, close: () => new Promise<void>((r) => { srv.closeAllConnections(); srv.close(() => r()); }) };
}

export const json = (res: ServerResponse, body: unknown, status = 200): void => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };

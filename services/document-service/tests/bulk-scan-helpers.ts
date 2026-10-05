/** Shared helpers for the bulk-scan real-DB tests (fake ports, inline queue, direct fixtures). */
import { randomUUID, createHash } from "node:crypto";
import { runWithTenant } from "@civitasone/db";
import { outboxMessages } from "@civitasone/outbox";
import { and, asc, inArray, isNull } from "drizzle-orm";
import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { db } from "../src/shared/db.js";
import { COMMANDS } from "../src/topics.js";
import { registerBulkScanConsumers } from "../src/modules/bulk-scan/consumer.js";
import { batches, batchFiles, settings } from "../src/modules/bulk-scan/schema.js";
import { keys } from "../src/modules/bulk-scan/keys.js";
import { settingsSchema } from "../src/modules/bulk-scan/validators.js";
import type { BlobStore, ScanVerdict, ScannerPort } from "../src/modules/bulk-scan/ports.js";
import { OcrStepError, type OcrPipelineInput, type OcrPipelineOutput, type OcrPipelinePort } from "../src/modules/bulk-scan/ocr-port.js";
import type { FileState } from "../src/modules/bulk-scan/state.js";

export const USER1 = "00000000-aaaa-4000-8000-000000000001";
export const USER2 = "00000000-aaaa-4000-8000-000000000002";
export const USER3 = "00000000-aaaa-4000-8000-000000000003";
const ownTenants = new Set<string>();
/** Tenants created by THIS test file; pump() relays only their outbox rows (the outbox table is shared across test files). */
export const newTenant = (): string => { const t = randomUUID(); ownTenants.add(t); return t; };

export type HandlerFn = (msg: CommandEnvelope) => Promise<void>;

/** A Queue that runs subscribed handlers inline (deterministic: no timers, no queue-level dedup/retry). */
export class InlineQueue {
  handlers = new Map<string, HandlerFn>();
  subscribe(topic: string, h: HandlerFn): void { this.handlers.set(topic, h); }
  async publish(topic: string, msg: CommandEnvelope): Promise<void> {
    const h = this.handlers.get(topic);
    if (h) await h(msg);
  }
  async start(): Promise<void> { /* noop */ }
  async stop(): Promise<void> { /* noop */ }
}

export function newInline(): { q: InlineQueue; as: Queue } {
  const q = new InlineQueue();
  registerBulkScanConsumers(q as unknown as Queue);
  return { q, as: q as unknown as Queue };
}

export function envelope(topic: string, tenantId: string, actorId: string, payload: unknown, messageId: string = randomUUID()): CommandEnvelope {
  return { messageId, type: topic, tenantId, actorId, correlationId: "corr-" + messageId.slice(0, 8), schemaVersion: "1.0", payload } as CommandEnvelope;
}

/** Run a command through its consumer. */
export async function send(q: InlineQueue, topic: string, tenantId: string, actorId: string, payload: unknown, messageId?: string): Promise<string> {
  const msg = envelope(topic, tenantId, actorId, payload, messageId);
  const h = q.handlers.get(topic);
  if (!h) throw new Error("no handler for " + topic);
  await h(msg);
  return msg.messageId;
}

/**
 * Relay THIS file's unpublished outbox rows into the inline queue until quiescent (internal step commands run
 * inline). Scoped to our own tenants so concurrently running test files never consume each other's rows.
 */
export async function pump(q: InlineQueue, max = 25): Promise<void> {
  for (let i = 0; i < max; i++) {
    const rows = await db.select().from(outboxMessages)
      .where(and(isNull(outboxMessages.publishedAt), inArray(outboxMessages.tenantId, [...ownTenants])))
      .orderBy(asc(outboxMessages.createdAt)).limit(200);
    if (rows.length === 0) return;
    for (const row of rows) {
      await q.publish(row.topic, {
        messageId: row.id, type: row.eventType, tenantId: row.tenantId, actorId: row.actorId,
        correlationId: row.correlationId, schemaVersion: row.schemaVersion, payload: row.payload,
      } as CommandEnvelope);
    }
    await db.update(outboxMessages).set({ publishedAt: new Date() }).where(inArray(outboxMessages.id, rows.map((r) => r.id)));
  }
}

export const tenantTx = <T>(tenantId: string, fn: (tx: typeof db) => Promise<T>): Promise<T> =>
  runWithTenant(tenantId, () => db.transaction((tx) => fn(tx as unknown as typeof db))) as Promise<T>;

// ── fakes ───────────────────────────────────────────────────────

export interface MemStore extends BlobStore { objects: Map<string, Buffer>; deleted: string[]; failPutPrefix: string | null }

export function memoryStore(): MemStore {
  const objects = new Map<string, Buffer>();
  const s: MemStore = {
    objects, deleted: [], failPutPrefix: null,
    async head(key) { const o = objects.get(key); return o ? { size: o.length, contentType: null } : null; },
    async get(key) { const o = objects.get(key); if (!o) throw new Error("NoSuchKey"); return o; },
    async put(key, body) {
      if (s.failPutPrefix && key.includes(s.failPutPrefix)) throw new Error("S3 put failed");
      objects.set(key, Buffer.isBuffer(body) ? body : Buffer.from(body));
    },
    async del(key) { objects.delete(key); s.deleted.push(key); },
    async presignGet({ key, expiresIn }) { return "https://s3.test/get/" + key + "?ttl=" + expiresIn + "&sig=x"; },
    async presignPut({ key, contentType }) { return { url: "https://s3.test/" + key + "?sig=x", headers: { "Content-Type": contentType } }; },
  };
  return s;
}

export function fakeScanner(initial: ScanVerdict = "clean"): ScannerPort & { verdict: ScanVerdict; calls: number } {
  const s = { verdict: initial, calls: 0, async scan(): Promise<ScanVerdict> { s.calls++; return s.verdict; } };
  return s;
}

export function okOutput(over: Partial<OcrPipelineOutput> = {}): OcrPipelineOutput {
  return {
    pageCount: 1, meanConfidence: 0.93, providerIds: ["tesseract"],
    maskedText: "Dear Sir, Aadhaar XXXX XXXX 1234",
    structuredJson: { schemaVersion: 1, pageCount: 1 },
    searchablePdf: new Uint8Array(Buffer.from("%PDF-fake-searchable")),
    classification: { docType: "letter", confidence: 0.9, evidence: ["kw:dear sir"], uncertain: false },
    fields: [{ kind: "date", value: "2020-01-01", raw: "01/01/2020", confidence: 0.9, pageNumber: 1, bbox: null }],
    piiFindings: [{ type: "aadhaar", pageNumber: 1, start: 12, end: 24, bbox: null, action: "mask", maskedPreview: "XXXX XXXX 1234" }],
    ...over,
  };
}

export interface FakeOcr extends OcrPipelinePort { calls: OcrPipelineInput[]; next: () => OcrPipelineOutput | Error }

export function fakeOcr(): FakeOcr {
  const f: FakeOcr = {
    calls: [], next: () => okOutput(),
    async run(input) {
      f.calls.push(input);
      const r = f.next();
      if (r instanceof Error) throw r;
      return r;
    },
  };
  return f;
}
export { OcrStepError };

// ── fixtures ────────────────────────────────────────────────────

export const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
export function pngBytes(tag: string): Buffer { return Buffer.concat([Buffer.from(PNG_HEAD), Buffer.from("IHDR-" + tag)]); }
export const sha = (b: Buffer): string => createHash("sha256").update(b).digest("hex");

export async function putSettings(tenantId: string, over: Record<string, unknown>, version = 1): Promise<void> {
  await tenantTx(tenantId, (tx) => tx.insert(settings).values({
    id: randomUUID(), tenantId, config: settingsSchema.parse(over) as unknown as Record<string, unknown>, version, createdBy: USER1, updatedBy: USER1,
  }).then(() => undefined));
}

export async function insertBatchRow(tenantId: string, over: Partial<typeof batches.$inferInsert> = {}): Promise<string> {
  const id = over.id ?? randomUUID();
  await tenantTx(tenantId, (tx) => tx.insert(batches).values({ id, tenantId, name: "fixture", status: "processing", fileCount: 1, createdBy: USER1, updatedBy: USER1, ...over }).then(() => undefined));
  return id;
}

export async function insertFileRow(tenantId: string, batchId: string, state: FileState, over: Partial<typeof batchFiles.$inferInsert> = {}): Promise<string> {
  const id = over.id ?? randomUUID();
  await tenantTx(tenantId, (tx) => tx.insert(batchFiles).values({
    id, tenantId, batchId, originalName: "f.png", mimeType: "image/png", declaredSizeBytes: 10, sizeBytes: 10,
    storageKey: keys.original(tenantId, batchId, id), state, createdBy: USER1, updatedBy: USER1, ...over,
  }).then(() => undefined));
  return id;
}

export interface Ingested { batchId: string; fileIds: string[] }

/** create batch -> register files -> (client uploads to the store) -> complete -> pump the pipeline up to the scan step. */
export async function ingest(
  q: InlineQueue, store: MemStore, tenantId: string,
  files: { name: string; bytes: Buffer; mime: string }[], batchOver: Record<string, unknown> = {}, actor = USER1,
): Promise<Ingested> {
  const batchId = randomUUID();
  await send(q, COMMANDS.bulkBatchCreate, tenantId, actor, { batchId, name: "Batch " + batchId.slice(0, 4), defaultTags: [], ...batchOver }, batchId);
  const reg = files.map((f) => {
    const id = randomUUID();
    return { id, name: f.name, mimeType: f.mime, sizeBytes: f.bytes.length, storageKey: keys.original(tenantId, batchId, id), bytes: f.bytes };
  });
  await send(q, COMMANDS.bulkFilesRegister, tenantId, actor, { batchId, files: reg.map(({ bytes: _b, ...r }) => r) });
  for (const r of reg) store.objects.set(r.storageKey, r.bytes);
  await send(q, COMMANDS.bulkFilesComplete, tenantId, actor, { batchId, fileIds: reg.map((r) => r.id) });
  return { batchId, fileIds: reg.map((r) => r.id) };
}

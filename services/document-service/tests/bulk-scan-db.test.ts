/**
 * bulk-scan real-DB tests (disposable Postgres, document_svc = NOBYPASSRLS so RLS really applies).
 * Fake object store / scanner / OCR ports; consumers are invoked through an inline queue.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { sql, eq, and } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { outboxMessages } from "@civitasone/outbox";
import { db, sqlClient } from "../src/shared/db.js";
import { COMMANDS } from "../src/topics.js";
import * as repo from "../src/modules/bulk-scan/repo.js";
import { batches, batchFiles, fileEvents, settings, settingsChangeRequests, profiles, links } from "../src/modules/bulk-scan/schema.js";
import { FILE_STATES, TRANSITIONS, IllegalTransitionError, type FileState } from "../src/modules/bulk-scan/state.js";
import { createDispatcher, sweepLeases, type DiscoveryPort } from "../src/modules/bulk-scan/dispatcher.js";
import { setPorts, resetPorts } from "../src/modules/bulk-scan/ports.js";
import { SCAN_MAX_ATTEMPTS } from "../src/modules/bulk-scan/pipeline.js";
import {
  USER1, USER2, USER3, newTenant, newInline, send, pump, tenantTx, memoryStore, fakeScanner, fakeOcr, okOutput, OcrStepError,
  pngBytes, sha, putSettings, insertBatchRow, insertFileRow, ingest,
} from "./bulk-scan-helpers.js";

const inT = <T>(t: string, fn: () => Promise<T>): Promise<T> => runWithTenant(t, fn) as Promise<T>;
const fileOf = (t: string, id: string) => inT(t, () => repo.getFile(t, id));
const eventsOf = (t: string, id: string) => inT(t, () => repo.listFileEvents(t, id));

let clock = new Date("2026-10-04T10:00:00Z");
const store = memoryStore();
const scanner = fakeScanner();
const ocr = fakeOcr();
const { q } = newInline();

/** Discovery that works through the app role by visiting known tenants under their own GUC (RLS stays on). */
function perTenantDiscovery(tenants: string[]): DiscoveryPort {
  return {
    async dueTenants(now) {
      const out: string[] = [];
      for (const t of tenants) {
        const d = await tenantTx(t, (tx) => repo.dueFilesForTenant(tx, t, now, 1));
        if (d.length) out.push(t);
      }
      return out.sort();
    },
    dueFiles: (t, now, cap) => tenantTx(t, (tx) => repo.dueFilesForTenant(tx, t, now, cap)),
    async expiredLeases(now, limit) {
      const all = [];
      for (const t of tenants) all.push(...(await tenantTx(t, (tx) => repo.discoverExpiredLeases(tx, now, limit))));
      return all;
    },
  };
}

beforeAll(() => {
  setPorts({ store, scanner, ocr, now: () => clock, random: () => 0.5 });
});
afterEach(() => {
  clock = new Date("2026-10-04T10:00:00Z");
  scanner.verdict = "clean";
  ocr.next = () => okOutput();
  store.failPutPrefix = null;
});
afterAll(async () => {
  resetPorts();
  await sqlClient.end();
});

async function runPipeline(tenants: string[], rounds = 6, slots = 8): Promise<void> {
  const d = createDispatcher({ discovery: perTenantDiscovery(tenants), slots });
  for (let i = 0; i < rounds; i++) {
    await pump(q);
    const r = await d.dispatchOnce();
    await pump(q);
    if (r.ocrClaimed + r.scanClaimed === 0) break;
  }
  await pump(q);
}

// ── transition(): the single write path ─────────────────────────

describe("transition() - every edge, illegal edges, races", () => {
  const tenant = newTenant();
  let batchId: string;
  beforeAll(async () => { batchId = await insertBatchRow(tenant, { fileCount: 500 }); });

  it("performs every legal edge in the table and records an event with from/to", async () => {
    for (const from of FILE_STATES) {
      for (const to of TRANSITIONS[from]) {
        const id = await insertFileRow(tenant, batchId, from, { canonicalForHash: false });
        const moved = await tenantTx(tenant, (tx) => repo.transition(tx, { tenantId: tenant, fileId: id, from: [from], to, reason: "T", actorId: USER1 }));
        expect(moved, `${from} -> ${to}`).toBe(true);
        const row = await fileOf(tenant, id);
        expect(row?.state).toBe(to);
        expect(row?.version).toBe(2);
        const ev = await eventsOf(tenant, id);
        expect(ev.map((e) => [e.fromState, e.toState])).toEqual([[from, to]]);
      }
    }
  });

  it("rejects every illegal edge before touching the DB", async () => {
    const id = await insertFileRow(tenant, batchId, "queued");
    for (const to of FILE_STATES.filter((s) => !TRANSITIONS.queued.includes(s))) {
      await expect(tenantTx(tenant, (tx) => repo.transition(tx, { tenantId: tenant, fileId: id, from: ["queued"], to })), `queued -> ${to}`)
        .rejects.toBeInstanceOf(IllegalTransitionError);
    }
    expect((await fileOf(tenant, id))?.state).toBe("queued");
    expect(await eventsOf(tenant, id)).toHaveLength(0);
  });

  it("returns false (someone else won) when the current state is not in `from`; no event is written", async () => {
    const id = await insertFileRow(tenant, batchId, "filed");
    const moved = await tenantTx(tenant, (tx) => repo.transition(tx, { tenantId: tenant, fileId: id, from: ["queued"], to: "ocr_running" }));
    expect(moved).toBe(false);
    expect((await fileOf(tenant, id))?.state).toBe("filed");
    expect(await eventsOf(tenant, id)).toHaveLength(0);
  });

  it("race: two concurrent conditional transitions - exactly one wins", async () => {
    for (let i = 0; i < 5; i++) {
      const id = await insertFileRow(tenant, batchId, "queued");
      const mv = (to: FileState) => tenantTx(tenant, (tx) => repo.transition(tx, { tenantId: tenant, fileId: id, from: ["queued"], to, reason: to }));
      const [a, b] = await Promise.all([mv("ocr_running"), mv("cancelled")]);
      expect([a, b].filter(Boolean)).toHaveLength(1);
      const ev = await eventsOf(tenant, id);
      expect(ev).toHaveLength(1);
      expect((await fileOf(tenant, id))?.state).toBe(ev[0]?.toState);
    }
  });

  it("applies the patch, bumps attempts, clears the lease outside leased states and releases the hash canon on failure", async () => {
    const id = await insertFileRow(tenant, batchId, "ocr_running", { attempts: 1, leaseExpiresAt: new Date(), canonicalForHash: true, sha256: sha(pngBytes("canon-" + id0())) });
    await tenantTx(tenant, (tx) => repo.transition(tx, {
      tenantId: tenant, fileId: id, from: ["ocr_running"], to: "failed", patch: { failureReason: "X", incrementAttempts: true }, reason: "X",
    }));
    const row = await fileOf(tenant, id);
    expect(row).toMatchObject({ state: "failed", failureReason: "X", attempts: 2, leaseExpiresAt: null, canonicalForHash: false });
  });

  it("is tenant scoped: another tenant cannot move the file", async () => {
    const id = await insertFileRow(tenant, batchId, "queued");
    const other = newTenant();
    const moved = await tenantTx(other, (tx) => repo.transition(tx, { tenantId: tenant, fileId: id, from: ["queued"], to: "ocr_running" }));
    expect(moved).toBe(false);
    expect((await fileOf(tenant, id))?.state).toBe("queued");
  });
});
const id0 = (): string => randomUUID();

// ── pipeline end to end ─────────────────────────────────────────

describe("pipeline with fake ports", () => {
  it("happy path: upload -> scan -> OCR -> ready_to_file, derivatives + masked metadata persisted, batch completes", async () => {
    const t = newTenant();
    const bytes = pngBytes("happy");
    const { batchId, fileIds } = await ingest(q, store, t, [{ name: "letter.png", bytes, mime: "image/png" }]);
    const id = fileIds[0] as string;
    expect((await fileOf(t, id))?.state).toBe("scanning");
    await runPipeline([t]);

    const row = await fileOf(t, id);
    expect(row).toMatchObject({
      state: "ready_to_file", scanStatus: "clean", docType: "letter", pageCount: 1, sha256: sha(bytes), sizeBytes: bytes.length,
      mimeType: "image/png", canonicalForHash: true, attempts: 0,
    });
    expect(Number(row?.ocrMeanConfidence)).toBeCloseTo(0.93, 3);
    expect(row?.piiFlags).toEqual(["aadhaar"]);                              // types only
    expect(JSON.stringify(row?.extractedFields)).not.toMatch(/\d{12}/);       // masked fields only
    expect(row?.reviewReasons).toEqual([]);
    for (const k of [row?.textMaskedKey, row?.structuredJsonKey, row?.searchablePdfKey]) expect(store.objects.has(k as string)).toBe(true);
    expect(store.objects.get(row?.textMaskedKey as string)?.toString()).toContain("XXXX XXXX 1234");
    expect(ocr.calls.at(-1)?.settings.pii.policy.aadhaar).toBe("mask");
    expect(ocr.calls.at(-1)?.settings.twoDigitYearPivot).toBe(49);

    const states = (await eventsOf(t, id)).map((e) => e.toState);
    expect(states).toEqual(["pending_upload", "uploaded", "scanning", "queued", "ocr_running", "extracted", "ready_to_file"]);
    const batch = await inT(t, () => repo.getBatch(t, batchId));
    expect(batch?.status).toBe("completed");
    expect(batch?.completedAt).not.toBeNull();
  });

  it("routes to needs_review: low confidence, uncertain class, PII policy, missing required field", async () => {
    const t = newTenant();
    await putSettings(t, { pii: { reviewOnDetect: true } });
    const cases: Array<[string, () => ReturnType<typeof okOutput>, string]> = [
      ["lowconf", () => okOutput({ meanConfidence: 0.5, piiFindings: [] }), "LOW_CONFIDENCE"],
      ["uncertain", () => okOutput({ piiFindings: [], classification: { docType: "other", confidence: 0.2, evidence: [], uncertain: true } }), "CLASSIFICATION_UNCERTAIN"],
      ["pii", () => okOutput(), "PII_DETECTED"],
      ["missing", () => okOutput({ piiFindings: [], classification: { docType: "bill_voucher", confidence: 0.9, evidence: [], uncertain: false }, fields: [] }), "MISSING_FIELD:amount_inr"],
    ];
    for (const [tag, mk, reason] of cases) {
      ocr.next = mk;
      const { fileIds } = await ingest(q, store, t, [{ name: tag + ".png", bytes: pngBytes(tag), mime: "image/png" }]);
      await runPipeline([t]);
      const row = await fileOf(t, fileIds[0] as string);
      expect(row?.state, tag).toBe("needs_review");
      expect(row?.reviewReasons, tag).toContain(reason);
    }
  });

  it("rejects bad content at upload-complete with machine-readable reasons (and removes hostile objects)", async () => {
    const t = newTenant();
    const mk = (tag: string, b: Buffer, mime: string) => ({ name: tag, bytes: b, mime });
    const { fileIds } = await ingest(q, store, t, [
      mk("a.png", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), "image/png"),
      mk("b.pdf", Buffer.concat([Buffer.from([0x4d, 0x5a, 0x90]), Buffer.from("exe")]), "application/pdf"),
      mk("c.pdf", Buffer.from("%PDF-1.5\ntrailer<< /Encrypt 4 0 R >>"), "application/pdf"),
      mk("d.png", Buffer.from("not an image at all"), "image/png"),
      mk("e.pdf", pngBytes("mismatch"), "application/pdf"),
    ]);
    const rows = await Promise.all(fileIds.map((id) => fileOf(t, id)));
    expect(rows.map((r) => [r?.state, r?.failureReason])).toEqual([
      ["failed", "SVG_NOT_ALLOWED"], ["failed", "EXECUTABLE_CONTENT"], ["failed", "ENCRYPTED_PDF"],
      ["failed", "UNSUPPORTED_FILE_TYPE"], ["failed", "MIME_MISMATCH"],
    ]);
    for (const r of rows) expect(store.objects.has(r?.storageKey as string)).toBe(false);   // hostile content deleted
    expect(scanner.calls).toBeGreaterThanOrEqual(0);
  });

  it("flags a size mismatch and a missing upload", async () => {
    const t = newTenant();
    const batchId = randomUUID();
    await send(q, COMMANDS.bulkBatchCreate, t, USER1, { batchId, name: "m", defaultTags: [] }, batchId);
    const mkf = (size: number) => { const id = randomUUID(); return { id, name: "x.png", mimeType: "image/png", sizeBytes: size, storageKey: `tenants/${t}/bulk-scan/${batchId}/${id}/original` }; };
    const f1 = mkf(999), f2 = mkf(50);
    await send(q, COMMANDS.bulkFilesRegister, t, USER1, { batchId, files: [f1, f2] });
    store.objects.set(f1.storageKey, pngBytes("small"));                 // declared 999, stored differently
    await send(q, COMMANDS.bulkFilesComplete, t, USER1, { batchId, fileIds: [f1.id, f2.id] });
    expect((await fileOf(t, f1.id))?.failureReason).toBe("SIZE_MISMATCH");
    expect((await fileOf(t, f2.id))?.failureReason).toBe("UPLOAD_MISSING");
  });

  it("enforces per-file and per-batch limits atomically in the consumer", async () => {
    const t = newTenant();
    await putSettings(t, { limits: { maxFileBytes: 2048, maxFilesPerBatch: 2, maxBatchBytes: 4096 } });
    const batchId = randomUUID();
    await send(q, COMMANDS.bulkBatchCreate, t, USER1, { batchId, name: "lim", defaultTags: [] }, batchId);
    const mkf = (size: number) => { const id = randomUUID(); return { id, name: "x.png", mimeType: "image/png", sizeBytes: size, storageKey: `tenants/${t}/bulk-scan/${batchId}/${id}/original` }; };
    await expect(send(q, COMMANDS.bulkFilesRegister, t, USER1, { batchId, files: [mkf(4000)] })).rejects.toThrow(/FILE_TOO_LARGE/);
    await send(q, COMMANDS.bulkFilesRegister, t, USER1, { batchId, files: [mkf(100), mkf(100)] });
    await expect(send(q, COMMANDS.bulkFilesRegister, t, USER1, { batchId, files: [mkf(100)] })).rejects.toThrow(/BATCH_LIMIT_OR_CLOSED/);
    const b = await inT(t, () => repo.getBatch(t, batchId));
    expect(b?.fileCount).toBe(2);
    // concurrent registrations can never overshoot the cap
    const b2 = randomUUID();
    await send(q, COMMANDS.bulkBatchCreate, t, USER1, { batchId: b2, name: "lim2", defaultTags: [] }, b2);
    const mk2 = () => { const id = randomUUID(); return { id, name: "x.png", mimeType: "image/png", sizeBytes: 10, storageKey: `tenants/${t}/bulk-scan/${b2}/${id}/original` }; };
    const res = await Promise.allSettled([1, 2, 3, 4].map(() => send(q, COMMANDS.bulkFilesRegister, t, USER1, { batchId: b2, files: [mk2()] })));
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    expect((await inT(t, () => repo.getBatch(t, b2)))?.fileCount).toBe(2);
  });

  it("QUARANTINE: infected files are quarantined, never OCR'd, no derivative; original moved to the quarantine prefix", async () => {
    const t = newTenant();
    scanner.verdict = "infected";
    const bytes = pngBytes("eicar");
    const ocrBefore = ocr.calls.length;
    const { batchId, fileIds } = await ingest(q, store, t, [{ name: "bad.png", bytes, mime: "image/png" }]);
    const id = fileIds[0] as string;
    const original = (await fileOf(t, id))?.storageKey as string;
    await runPipeline([t]);
    const row = await fileOf(t, id);
    expect(row).toMatchObject({ state: "quarantined", scanStatus: "infected", failureReason: "MALWARE_DETECTED", textMaskedKey: null, searchablePdfKey: null, structuredJsonKey: null });
    expect(row?.quarantineKey).toContain(`/bulk-scan-quarantine/${batchId}/${id}`);
    expect(store.objects.get(row?.quarantineKey as string)?.equals(bytes)).toBe(true);
    expect(store.objects.has(original)).toBe(false);
    expect(ocr.calls.length).toBe(ocrBefore);                         // never reached OCR
    const audit = await tenantTx(t, (tx) => tx.select().from(outboxMessages).where(and(eq(outboxMessages.tenantId, t), eq(outboxMessages.topic, "audit.event.record"))));
    expect(audit.some((a) => (a.payload as { action?: string }).action === "quarantine")).toBe(true);
    expect((await inT(t, () => repo.getBatch(t, batchId)))?.status).toBe("completed");
    // a quarantined file is terminal: cannot be retried or skipped
    await expect(send(q, COMMANDS.bulkFileRetry, t, USER1, { fileId: id })).rejects.toThrow(/NOT_RETRYABLE/);
    await expect(send(q, COMMANDS.bulkFileSkip, t, USER1, { fileId: id })).rejects.toThrow(/NOT_SKIPPABLE/);
  });

  it("FAIL-CLOSED: scanner outage holds the file in scan_pending with backoff, never processes it, then recovers", async () => {
    const t = newTenant();
    scanner.verdict = "error";
    const ocrBefore = ocr.calls.length;
    const { fileIds } = await ingest(q, store, t, [{ name: "hold.png", bytes: pngBytes("hold"), mime: "image/png" }]);
    const id = fileIds[0] as string;
    await pump(q);
    let row = await fileOf(t, id);
    expect(row).toMatchObject({ state: "scan_pending", scanStatus: "error", attempts: 1 });
    expect(row?.nextAttemptAt && row.nextAttemptAt.getTime() > clock.getTime()).toBe(true);

    // not due yet: the dispatcher leaves it alone
    const d = createDispatcher({ discovery: perTenantDiscovery([t]), slots: 4 });
    expect(await d.dispatchOnce()).toMatchObject({ scanClaimed: 0, ocrClaimed: 0 });
    // due, scanner still down: back to scan_pending with a later retry, attempts grows
    clock = new Date(clock.getTime() + 3_600_000);
    expect((await d.dispatchOnce()).scanClaimed).toBe(1);
    await pump(q);
    row = await fileOf(t, id);
    expect(row?.state).toBe("scan_pending");
    expect(row?.attempts).toBe(2);
    expect(ocr.calls.length).toBe(ocrBefore);                       // NEVER processed unscanned

    // scanner recovers
    scanner.verdict = "clean";
    clock = new Date(clock.getTime() + 3_600_000);
    await runPipeline([t]);
    row = await fileOf(t, id);
    expect(row?.state).toBe("ready_to_file");
    expect(row?.scanStatus).toBe("clean");
    expect(row?.attempts).toBe(0);
  });

  it("FAIL-CLOSED: after the scan retry budget the file is dead-lettered (still never processed)", async () => {
    const t = newTenant();
    scanner.verdict = "error";
    const { fileIds } = await ingest(q, store, t, [{ name: "dead.png", bytes: pngBytes("deadscan"), mime: "image/png" }]);
    const id = fileIds[0] as string;
    const d = createDispatcher({ discovery: perTenantDiscovery([t]), slots: 4 });
    await pump(q);
    for (let i = 1; i < SCAN_MAX_ATTEMPTS; i++) {
      clock = new Date(clock.getTime() + 24 * 3_600_000);
      await d.dispatchOnce();
      await pump(q);
    }
    const row = await fileOf(t, id);
    expect(row).toMatchObject({ state: "failed", failureReason: "SCAN_UNAVAILABLE", deadLetter: true });
    expect(row?.scanStatus).toBe("error");
  });

  it("fail-open ONLY when the tenant setting turns fail-closed off (and it is audited)", async () => {
    const t = newTenant();
    await putSettings(t, { malwareFailClosed: false });
    scanner.verdict = "error";
    const { fileIds } = await ingest(q, store, t, [{ name: "open.png", bytes: pngBytes("failopen"), mime: "image/png" }]);
    await pump(q);
    const row = await fileOf(t, fileIds[0] as string);
    expect(row).toMatchObject({ state: "queued", scanStatus: "skipped_unavailable" });
    const audit = await tenantTx(t, (tx) => tx.select().from(outboxMessages).where(and(eq(outboxMessages.tenantId, t), eq(outboxMessages.topic, "audit.event.record"))));
    expect(audit.some((a) => (a.payload as { action?: string }).action === "scan_fail_open")).toBe(true);
  });

  it("duplicate policy skip: same content in the tenant is skipped_duplicate pointing at the first file", async () => {
    const t = newTenant();
    const bytes = pngBytes("dup-skip");
    const a = await ingest(q, store, t, [{ name: "1.png", bytes, mime: "image/png" }]);
    const b = await ingest(q, store, t, [{ name: "2.png", bytes, mime: "image/png" }]);
    const second = await fileOf(t, b.fileIds[0] as string);
    expect(second).toMatchObject({ state: "skipped_duplicate", duplicateOf: a.fileIds[0], duplicateAction: "skip", canonicalForHash: false });
    expect((await fileOf(t, a.fileIds[0] as string))?.state).toBe("scanning");
    // tenant scoped: the same bytes in another tenant are NOT a duplicate
    const other = newTenant();
    const c = await ingest(q, store, other, [{ name: "3.png", bytes, mime: "image/png" }]);
    expect((await fileOf(other, c.fileIds[0] as string))?.state).toBe("scanning");
  });

  it("duplicate policy link: skipped_duplicate carrying duplicate_action=link; keep: processed, duplicate_of informational", async () => {
    const t = newTenant();
    await putSettings(t, { duplicatePolicy: "link" });
    const bytes = pngBytes("dup-link");
    const a = await ingest(q, store, t, [{ name: "1.png", bytes, mime: "image/png" }]);
    const b = await ingest(q, store, t, [{ name: "2.png", bytes, mime: "image/png" }]);
    expect(await fileOf(t, b.fileIds[0] as string)).toMatchObject({ state: "skipped_duplicate", duplicateOf: a.fileIds[0], duplicateAction: "link" });

    const k = newTenant();
    await putSettings(k, { duplicatePolicy: "keep" });
    const kb = pngBytes("dup-keep");
    const k1 = await ingest(q, store, k, [{ name: "1.png", bytes: kb, mime: "image/png" }]);
    const k2 = await ingest(q, store, k, [{ name: "2.png", bytes: kb, mime: "image/png" }]);
    const r2 = await fileOf(k, k2.fileIds[0] as string);
    expect(r2).toMatchObject({ state: "scanning", duplicateOf: k1.fileIds[0], canonicalForHash: false });
  });

  it("duplicates completing CONCURRENTLY: exactly one canonical, the other skipped (advisory lock + unique index)", async () => {
    const t = newTenant();
    const bytes = pngBytes("dup-race");
    const mkBatch = async () => {
      const batchId = randomUUID(); const id = randomUUID();
      await send(q, COMMANDS.bulkBatchCreate, t, USER1, { batchId, name: "r", defaultTags: [] }, batchId);
      const key = `tenants/${t}/bulk-scan/${batchId}/${id}/original`;
      await send(q, COMMANDS.bulkFilesRegister, t, USER1, { batchId, files: [{ id, name: "r.png", mimeType: "image/png", sizeBytes: bytes.length, storageKey: key }] });
      store.objects.set(key, bytes);
      return { batchId, id };
    };
    const [x, y, z] = [await mkBatch(), await mkBatch(), await mkBatch()];
    await Promise.all([x, y, z].map((f) => send(q, COMMANDS.bulkFilesComplete, t, USER1, { batchId: f.batchId, fileIds: [f.id] })));
    const rows = await Promise.all([x, y, z].map((f) => fileOf(t, f.id)));
    expect(rows.filter((r) => r?.state === "scanning" && r.canonicalForHash)).toHaveLength(1);
    expect(rows.filter((r) => r?.state === "skipped_duplicate")).toHaveLength(2);
  });

  it("OCR transient failures retry with backoff, then dead-letter at the attempt budget with a scrubbed reason", async () => {
    const t = newTenant();
    ocr.next = () => new OcrStepError("OCR_FAILED", "provider blew up near 1234 5678 9012", true);
    const { fileIds } = await ingest(q, store, t, [{ name: "retry.png", bytes: pngBytes("retry"), mime: "image/png" }]);
    const id = fileIds[0] as string;
    const d = createDispatcher({ discovery: perTenantDiscovery([t]), slots: 4 });
    await pump(q);                                  // scan -> queued
    for (let i = 0; i < 5; i++) {
      await d.dispatchOnce();
      await pump(q);
      const row = await fileOf(t, id);
      if (i < 4) {
        expect(row?.state).toBe("queued");
        expect(row?.attempts).toBe(i + 1);
        expect(row?.nextAttemptAt && row.nextAttemptAt.getTime() > clock.getTime()).toBe(true);
        expect(await d.dispatchOnce()).toMatchObject({ ocrClaimed: 0 });          // backoff respected
        clock = new Date(clock.getTime() + 3_600_000);
      }
    }
    const row = await fileOf(t, id);
    expect(row).toMatchObject({ state: "failed", failureReason: "MAX_ATTEMPTS", deadLetter: true, attempts: 5 });
    expect(row?.failureDetail).not.toMatch(/1234 5678 9012/);
    const dl = await tenantTx(t, (tx) => tx.select().from(outboxMessages).where(and(eq(outboxMessages.tenantId, t), eq(outboxMessages.topic, "audit.event.record"))));
    expect(dl.some((a) => (a.payload as { action?: string }).action === "dead_letter")).toBe(true);

    // operator retry resets the budget (file was scanned clean => back to queued)
    ocr.next = () => okOutput();
    await send(q, COMMANDS.bulkFileRetry, t, USER1, { fileId: id });
    expect(await fileOf(t, id)).toMatchObject({ state: "queued", attempts: 0, deadLetter: false, failureReason: null });
    await runPipeline([t]);
    expect((await fileOf(t, id))?.state).toBe("ready_to_file");
  });

  it("permanent OCR errors fail the file immediately (not dead-letter) and cannot be retried", async () => {
    const t = newTenant();
    ocr.next = () => new OcrStepError("CORRUPT", "PDF has no pages", false);
    const { fileIds } = await ingest(q, store, t, [{ name: "corrupt.png", bytes: pngBytes("corrupt"), mime: "image/png" }]);
    await runPipeline([t]);
    const row = await fileOf(t, fileIds[0] as string);
    expect(row).toMatchObject({ state: "failed", failureReason: "CORRUPT", deadLetter: false });
    await expect(send(q, COMMANDS.bulkFileRetry, t, USER1, { fileId: fileIds[0] })).rejects.toThrow(/NOT_RETRYABLE/);
  });

  it("derivative write failure is retried (not lost)", async () => {
    const t = newTenant();
    const { fileIds } = await ingest(q, store, t, [{ name: "deriv.png", bytes: pngBytes("deriv"), mime: "image/png" }]);
    store.failPutPrefix = "/derived/";
    await runPipeline([t], 3);
    const row = await fileOf(t, fileIds[0] as string);
    expect(row?.state).toBe("queued");
    expect(row?.failureReason).toBe("DERIVATIVE_WRITE_FAILED");
    expect(row?.attempts).toBe(1);
  });

  it("operator skip and batch cancel move files to terminal states and keep events", async () => {
    const t = newTenant();
    scanner.verdict = "error";
    const { batchId, fileIds } = await ingest(q, store, t, [
      { name: "s1.png", bytes: pngBytes("skip1"), mime: "image/png" },
      { name: "s2.png", bytes: pngBytes("skip2"), mime: "image/png" },
    ]);
    await pump(q);
    expect((await fileOf(t, fileIds[0] as string))?.state).toBe("scan_pending");
    await send(q, COMMANDS.bulkFileSkip, t, USER1, { fileId: fileIds[0], reason: "duplicate paper copy" });
    expect(await fileOf(t, fileIds[0] as string)).toMatchObject({ state: "skipped" });
    await send(q, COMMANDS.bulkBatchCancel, t, USER1, { batchId });
    expect((await fileOf(t, fileIds[1] as string))?.state).toBe("cancelled");
    expect((await inT(t, () => repo.getBatch(t, batchId)))?.status).toBe("cancelled");
    await expect(send(q, COMMANDS.bulkBatchCancel, t, USER1, { batchId })).rejects.toThrow(/BATCH_NOT_CANCELLABLE/);
    // cancelled batches accept no more files
    const f = randomUUID();
    await expect(send(q, COMMANDS.bulkFilesRegister, t, USER1, { batchId, files: [{ id: f, name: "x.png", mimeType: "image/png", sizeBytes: 5, storageKey: `tenants/${t}/bulk-scan/${batchId}/${f}/original` }] }))
      .rejects.toThrow(/BATCH_LIMIT_OR_CLOSED/);
  });
});

// ── redelivery idempotency ──────────────────────────────────────

describe("consumer redelivery idempotency (same messageId twice => one effect)", () => {
  it("batch create / register / complete", async () => {
    const t = newTenant();
    const batchId = randomUUID();
    const createId = randomUUID();
    await send(q, COMMANDS.bulkBatchCreate, t, USER1, { batchId, name: "idem", defaultTags: [] }, createId);
    await send(q, COMMANDS.bulkBatchCreate, t, USER1, { batchId, name: "idem", defaultTags: [] }, createId);       // redelivery
    const audit = () => tenantTx(t, (tx) => tx.select().from(outboxMessages).where(and(eq(outboxMessages.tenantId, t), eq(outboxMessages.topic, "audit.event.record"))));
    expect((await audit()).filter((a) => (a.payload as { action?: string }).action === "batch_create")).toHaveLength(1);

    const fid = randomUUID();
    const reg = { batchId, files: [{ id: fid, name: "i.png", mimeType: "image/png", sizeBytes: 20, storageKey: `tenants/${t}/bulk-scan/${batchId}/${fid}/original` }] };
    const regId = randomUUID();
    await send(q, COMMANDS.bulkFilesRegister, t, USER1, reg, regId);
    await send(q, COMMANDS.bulkFilesRegister, t, USER1, reg, regId);
    expect((await inT(t, () => repo.getBatch(t, batchId)))?.fileCount).toBe(1);
    expect(await eventsOf(t, fid)).toHaveLength(1);

    const bytes = pngBytes("idem-file");
    store.objects.set(reg.files[0]?.storageKey as string, bytes);
    await tenantTx(t, (tx) => tx.update(batchFiles).set({ declaredSizeBytes: bytes.length }).where(eq(batchFiles.id, fid)).then(() => undefined));
    const compId = randomUUID();
    await send(q, COMMANDS.bulkFilesComplete, t, USER1, { batchId, fileIds: [fid] }, compId);
    await send(q, COMMANDS.bulkFilesComplete, t, USER1, { batchId, fileIds: [fid] }, compId);
    expect((await eventsOf(t, fid)).map((e) => e.toState)).toEqual(["pending_upload", "uploaded", "scanning"]);
  });

  it("concurrent in-flight duplicates of a settings approval: one effect", async () => {
    const t = newTenant();
    const reqId = randomUUID();
    await send(q, COMMANDS.bulkSettingsPropose, t, USER1, { requestId: reqId, settings: { dpi: 450 } }, reqId);
    const msgId = randomUUID();
    const res = await Promise.allSettled([1, 2].map(() => send(q, COMMANDS.bulkSettingsApprove, t, USER2, { requestId: reqId, actorRoles: ["document_admin"] }, msgId)));
    expect(res.every((r) => r.status === "fulfilled")).toBe(true);
    const eff = await inT(t, () => repo.resolveEffectiveSettings(t));
    expect(eff.version).toBe(1);
    expect(eff.settings.dpi).toBe(450);
  });

  it("a redelivered pipeline step cannot move a file twice", async () => {
    const t = newTenant();
    const { fileIds } = await ingest(q, store, t, [{ name: "step.png", bytes: pngBytes("step"), mime: "image/png" }]);
    const id = fileIds[0] as string;
    const stepMsg = randomUUID();
    await send(q, COMMANDS.bulkStepScan, t, USER1, { fileId: id }, stepMsg);
    await send(q, COMMANDS.bulkStepScan, t, USER1, { fileId: id }, stepMsg);
    expect((await eventsOf(t, id)).filter((e) => e.toState === "queued")).toHaveLength(1);
  });
});

// ── dispatcher: bounded per-tenant concurrency, fairness, lease sweeper ─────

describe("dispatcher and lease sweeper (real DB)", () => {
  it("claims fairly across tenants and never exceeds a tenant's concurrency setting", async () => {
    const x = newTenant(), y = newTenant();
    const bx = await insertBatchRow(x), by = await insertBatchRow(y);
    for (let i = 0; i < 6; i++) await insertFileRow(x, bx, "queued", { sha256: null });
    for (let i = 0; i < 3; i++) await insertFileRow(y, by, "queued");
    const d = createDispatcher({ discovery: perTenantDiscovery([x, y]), slots: 3 });
    const running = (t: string) => tenantTx(t, (tx) => repo.countInState(tx, t, "ocr_running"));

    const r1 = await d.dispatchOnce();
    expect(r1.ocrClaimed).toBe(3);
    const [rx1, ry1] = [await running(x), await running(y)];
    expect(rx1 + ry1).toBe(3);
    expect(rx1).toBeGreaterThanOrEqual(1);
    expect(ry1).toBeGreaterThanOrEqual(1);                         // the small tenant is served in the first tick
    expect(rx1).toBeLessThanOrEqual(2);
    expect(ry1).toBeLessThanOrEqual(2);

    await d.dispatchOnce();
    await d.dispatchOnce();
    expect(await running(x)).toBe(2);                              // concurrency=2 is a hard bound
    expect(await running(y)).toBe(2);
    expect((await d.dispatchOnce()).ocrClaimed).toBe(0);
  });

  it("per-tenant concurrency follows the tenant setting, enforced under concurrent claims", async () => {
    const t = newTenant();
    await putSettings(t, { concurrency: 1 });
    const b = await insertBatchRow(t);
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push(await insertFileRow(t, b, "queued"));
    const due = ids.map((fileId) => ({ tenantId: t, fileId, state: "queued" as const }));
    const { claimForTenant } = await import("../src/modules/bulk-scan/dispatcher.js");
    // two dispatcher instances racing for the same tenant
    await Promise.all([
      runWithTenant(t, () => claimForTenant(t, due, [], clock, 60_000)),
      runWithTenant(t, () => claimForTenant(t, due, [], clock, 60_000)),
    ]);
    expect(await tenantTx(t, (tx) => repo.countInState(tx, t, "ocr_running"))).toBe(1);
  });

  it("lease sweeper re-queues expired in-flight files (attempts+1), leaves live leases, dead-letters at budget", async () => {
    const t = newTenant();
    const b = await insertBatchRow(t, { fileCount: 6 });
    const past = new Date(clock.getTime() - 60_000), future = new Date(clock.getTime() + 600_000);
    const ocrStuck = await insertFileRow(t, b, "ocr_running", { leaseExpiresAt: past, attempts: 0 });
    const scanStuck = await insertFileRow(t, b, "scanning", { leaseExpiresAt: past, attempts: 1 });
    const live = await insertFileRow(t, b, "ocr_running", { leaseExpiresAt: future });
    const exhausted = await insertFileRow(t, b, "ocr_running", { leaseExpiresAt: past, attempts: 4 });
    const res = await sweepLeases({ discovery: perTenantDiscovery([t]) }, clock);
    expect(res).toEqual({ requeued: 2, deadLettered: 1 });
    expect(await fileOf(t, ocrStuck)).toMatchObject({ state: "queued", attempts: 1, leaseExpiresAt: null });
    expect(await fileOf(t, scanStuck)).toMatchObject({ state: "scan_pending", attempts: 2 });
    expect((await fileOf(t, live))?.state).toBe("ocr_running");
    expect(await fileOf(t, exhausted)).toMatchObject({ state: "failed", failureReason: "MAX_ATTEMPTS", deadLetter: true });
    // sweeping again is a no-op (conditional)
    expect(await sweepLeases({ discovery: perTenantDiscovery([t]) }, clock)).toEqual({ requeued: 0, deadLettered: 0 });
  });

  it("crash-resumable: a file stuck in ocr_running is swept, re-dispatched and completes", async () => {
    const t = newTenant();
    const { fileIds } = await ingest(q, store, t, [{ name: "crash.png", bytes: pngBytes("crash"), mime: "image/png" }]);
    const id = fileIds[0] as string;
    await pump(q);                                                          // scan -> queued
    // simulate a worker that claimed the file then died before running the step
    await tenantTx(t, (tx) => repo.transition(tx, { tenantId: t, fileId: id, from: ["queued"], to: "ocr_running", patch: { leaseExpiresAt: new Date(clock.getTime() + 1000) } }));
    clock = new Date(clock.getTime() + 3_600_000);
    await sweepLeases({ discovery: perTenantDiscovery([t]) }, clock);
    expect((await fileOf(t, id))?.state).toBe("queued");
    await runPipeline([t]);
    expect((await fileOf(t, id))?.state).toBe("ready_to_file");
  });
});

// ── settings maker-checker ──────────────────────────────────────

describe("settings change requests: maker != checker", () => {
  const propose = async (t: string, maker: string, settingsDoc: unknown, reason?: string): Promise<string> => {
    const requestId = randomUUID();
    await send(q, COMMANDS.bulkSettingsPropose, t, maker, { requestId, settings: settingsDoc, ...(reason ? { reason } : {}) }, requestId);
    return requestId;
  };
  const approve = (t: string, checker: string, requestId: string, superAdmin = false) =>
    send(q, COMMANDS.bulkSettingsApprove, t, checker, { requestId, actorRoles: superAdmin ? ["super_admin"] : ["document_admin"] });

  it("the maker cannot approve their own change; a different admin can, and it takes effect", async () => {
    const t = newTenant();
    const id = await propose(t, USER1, { dpi: 400 });
    expect((await inT(t, () => repo.resolveEffectiveSettings(t))).settings.dpi).toBe(300);       // nothing applied yet
    await expect(approve(t, USER1, id)).rejects.toThrow(/MAKER_CHECKER_VIOLATION/);
    expect((await inT(t, () => repo.getChangeRequest(t, id)))?.status).toBe("pending");
    await approve(t, USER2, id);
    const eff = await inT(t, () => repo.resolveEffectiveSettings(t));
    expect(eff.settings.dpi).toBe(400);
    expect(eff.version).toBe(1);
    const cr = await inT(t, () => repo.getChangeRequest(t, id));
    expect(cr).toMatchObject({ status: "approved", maker: USER1, checker: USER2 });
    await expect(approve(t, USER3, id)).rejects.toThrow(/NOT_PENDING/);
  });

  it("concurrent approvals by two different checkers: exactly one wins", async () => {
    const t = newTenant();
    const id = await propose(t, USER1, { concurrency: 4 });
    const res = await Promise.allSettled([approve(t, USER2, id), approve(t, USER3, id)]);
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const lost = res.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(String(lost.reason)).toMatch(/NOT_PENDING/);
    const eff = await inT(t, () => repo.resolveEffectiveSettings(t));
    expect(eff.version).toBe(1);
    expect(eff.settings.concurrency).toBe(4);
  });

  it("approving one request supersedes older pending proposals", async () => {
    const t = newTenant();
    const a = await propose(t, USER1, { dpi: 350 });
    const b = await propose(t, USER3, { dpi: 500 });
    await approve(t, USER2, a);
    expect((await inT(t, () => repo.getChangeRequest(t, b)))?.status).toBe("superseded");
    await expect(approve(t, USER2, b)).rejects.toThrow(/NOT_PENDING/);
    expect((await inT(t, () => repo.resolveEffectiveSettings(t))).settings.dpi).toBe(350);
  });

  it("a stale proposal (settings moved since) cannot be approved", async () => {
    const t = newTenant();
    await putSettings(t, { dpi: 320 }, 3);
    const id = randomUUID();
    await tenantTx(t, (tx) => tx.insert(settingsChangeRequests).values({ id, tenantId: t, proposed: { dpi: 600 }, baseVersion: 0, maker: USER1 }).then(() => undefined));
    await expect(approve(t, USER2, id)).rejects.toThrow(/STALE_BASE/);
  });

  it("turning malware fail-closed OFF needs a reason and a super_admin approver", async () => {
    const t = newTenant();
    await expect(propose(t, USER1, { malwareFailClosed: false })).rejects.toThrow(/REASON_REQUIRED/);
    const id = await propose(t, USER1, { malwareFailClosed: false }, "ClamAV decommissioned for UAT");
    const cr = await inT(t, () => repo.getChangeRequest(t, id));
    expect(cr?.sensitive).toBe(true);
    await expect(approve(t, USER2, id, false)).rejects.toThrow(/SUPER_ADMIN_REQUIRED/);
    expect((await inT(t, () => repo.resolveEffectiveSettings(t))).settings.malwareFailClosed).toBe(true);
    await expect(approve(t, USER1, id, true)).rejects.toThrow(/MAKER_CHECKER_VIOLATION/);      // even a super_admin maker
    await approve(t, USER2, id, true);
    expect((await inT(t, () => repo.resolveEffectiveSettings(t))).settings.malwareFailClosed).toBe(false);
  });

  it("reject: by a different user only, with a reason; afterwards it can no longer be approved", async () => {
    const t = newTenant();
    const id = await propose(t, USER1, { dpi: 380 });
    await expect(send(q, COMMANDS.bulkSettingsReject, t, USER1, { requestId: id, reason: "changed my mind" })).rejects.toThrow(/MAKER_CHECKER_VIOLATION/);
    await send(q, COMMANDS.bulkSettingsReject, t, USER2, { requestId: id, reason: "too aggressive" });
    expect(await inT(t, () => repo.getChangeRequest(t, id))).toMatchObject({ status: "rejected", checker: USER2, decisionReason: "too aggressive" });
    await expect(approve(t, USER3, id)).rejects.toThrow(/NOT_PENDING/);
    expect((await inT(t, () => repo.resolveEffectiveSettings(t))).settings.dpi).toBe(300);
  });

  it("rejects invalid proposals at the consumer boundary", async () => {
    const t = newTenant();
    await expect(propose(t, USER1, { dpi: 9000 })).rejects.toThrow(/INVALID_SETTINGS/);
    await expect(propose(t, USER1, { providerChain: [{ id: "nope" }] })).rejects.toThrow(/INVALID_SETTINGS/);
  });

  it("the table itself refuses maker = checker (defence in depth)", async () => {
    const t = newTenant();
    const id = randomUUID();
    await expect(tenantTx(t, (tx) => tx.insert(settingsChangeRequests).values({ id, tenantId: t, proposed: {}, maker: USER1, checker: USER1, status: "approved" }).then(() => undefined)))
      .rejects.toThrow();
  });
});

describe("profiles", () => {
  it("create / name uniqueness / optimistic update / soft delete / effective settings with profile", async () => {
    const t = newTenant();
    const pid = randomUUID();
    await send(q, COMMANDS.bulkProfileCreate, t, USER1, { profileId: pid, name: "Service book (Hindi + English)", config: { languages: ["hin", "eng"], dpi: 400 } }, pid);
    await expect(send(q, COMMANDS.bulkProfileCreate, t, USER1, { profileId: randomUUID(), name: "service BOOK (hindi + english)", config: {} })).rejects.toThrow(/PROFILE_NAME_TAKEN/);
    await expect(send(q, COMMANDS.bulkProfileCreate, t, USER1, { profileId: randomUUID(), name: "bad", config: { malwareFailClosed: false } })).rejects.toThrow(/INVALID_PROFILE/);

    const eff = await inT(t, () => repo.resolveEffectiveSettings(t, pid));
    expect(eff.settings).toMatchObject({ dpi: 400, languages: ["hin", "eng"], malwareFailClosed: true });
    expect(eff.profileId).toBe(pid);

    await send(q, COMMANDS.bulkProfileUpdate, t, USER2, { profileId: pid, expectedVersion: 1, config: { dpi: 450 } });
    await expect(send(q, COMMANDS.bulkProfileUpdate, t, USER2, { profileId: pid, expectedVersion: 1, config: { dpi: 500 } })).rejects.toThrow(/PROFILE_VERSION_CONFLICT_OR_MISSING/);
    expect((await inT(t, () => repo.resolveEffectiveSettings(t, pid))).settings.dpi).toBe(450);

    await send(q, COMMANDS.bulkProfileDelete, t, USER1, { profileId: pid });
    expect(await inT(t, () => repo.listProfiles(t))).toHaveLength(0);
    expect((await inT(t, () => repo.resolveEffectiveSettings(t, pid))).profileId).toBeNull();      // deleted profile falls back to tenant settings
    // name can be reused after soft delete
    await send(q, COMMANDS.bulkProfileCreate, t, USER1, { profileId: randomUUID(), name: "Service book (Hindi + English)", config: {} });
  });

  it("a batch must reference an existing profile, allowed doc type and allowed link target", async () => {
    const t = newTenant();
    await putSettings(t, { allowedLinkTargets: ["hr_employee"] });
    const mk = (extra: Record<string, unknown>) => send(q, COMMANDS.bulkBatchCreate, t, USER1, { batchId: randomUUID(), name: "b", defaultTags: [], ...extra });
    await expect(mk({ profileId: randomUUID() })).rejects.toThrow(/UNKNOWN_PROFILE/);
    await expect(mk({ defaultDocType: "nonexistent" })).rejects.toThrow(/UNKNOWN_DOC_TYPE/);
    await expect(mk({ linkTarget: { target: "finance_bill" } })).rejects.toThrow(/LINK_TARGET_NOT_ALLOWED/);
    await mk({ defaultDocType: "pay_slip", linkTarget: { target: "hr_employee" } });
  });
});

// ── RLS isolation + schema/migration sync ───────────────────────

describe("tenant isolation (RLS) and migration sync", () => {
  it("tenant B cannot see or touch tenant A's batch, files, events, settings, profiles, links", async () => {
    const a = newTenant(), b = newTenant();
    const batchId = await insertBatchRow(a);
    const fileId = await insertFileRow(a, batchId, "needs_review");
    await putSettings(a, { dpi: 333 });
    const profileId = randomUUID();
    await tenantTx(a, (tx) => tx.insert(profiles).values({ id: profileId, tenantId: a, name: "pa", config: {}, createdBy: USER1, updatedBy: USER1 }).then(() => undefined));
    await tenantTx(a, (tx) => tx.insert(links).values({ id: randomUUID(), tenantId: a, fileId, target: "hr_employee", targetId: "E1", requestedBy: USER1 }).then(() => undefined));
    await tenantTx(a, (tx) => repo.transition(tx, { tenantId: a, fileId, from: ["needs_review"], to: "skipped" }));

    // reads under B's GUC, even naming A's tenant id explicitly
    expect(await inT(b, () => repo.getBatch(a, batchId))).toBeNull();
    expect(await inT(b, () => repo.getFile(a, fileId))).toBeNull();
    expect(await inT(b, () => repo.listFileEvents(a, fileId))).toHaveLength(0);
    expect(await inT(b, () => repo.getSettingsRow(a))).toBeNull();
    expect(await inT(b, () => repo.getProfile(a, profileId))).toBeNull();
    expect(await inT(b, () => repo.stateCounts(a, [batchId]))).toEqual(new Map());
    expect((await inT(b, () => repo.resolveEffectiveSettings(b))).settings.dpi).toBe(300);          // B sees defaults, not A's 333
    expect((await inT(a, () => repo.resolveEffectiveSettings(a))).settings.dpi).toBe(333);
    const linkRows = await tenantTx(b, (tx) => tx.select().from(links).where(eq(links.tenantId, a)));
    expect(linkRows).toHaveLength(0);

    // writes under B's GUC affect nothing
    const upd = await tenantTx(b, (tx) => tx.update(batchFiles).set({ state: "failed" }).where(eq(batchFiles.id, fileId)).returning({ id: batchFiles.id }));
    expect(upd).toHaveLength(0);
    const updB = await tenantTx(b, (tx) => tx.update(batches).set({ name: "pwned" }).where(eq(batches.id, batchId)).returning({ id: batches.id }));
    expect(updB).toHaveLength(0);
    const updS = await tenantTx(b, (tx) => tx.update(settings).set({ version: 99 }).where(eq(settings.tenantId, a)).returning({ id: settings.id }));
    expect(updS).toHaveLength(0);
    const del = await tenantTx(b, (tx) => tx.delete(profiles).where(eq(profiles.id, profileId)).returning({ id: profiles.id }));
    expect(del).toHaveLength(0);
    expect(await tenantTx(b, (tx) => repo.transition(tx, { tenantId: a, fileId, from: ["skipped"], to: "failed" }).catch(() => false))).toBe(false);
    // inserting a row for another tenant is refused by the policy
    await expect(tenantTx(b, (tx) => tx.insert(batches).values({ id: randomUUID(), tenantId: a, name: "x", createdBy: USER1, updatedBy: USER1 }).then(() => undefined))).rejects.toThrow();
    // A's data is intact
    expect((await fileOf(a, fileId))?.state).toBe("skipped");
    expect((await inT(a, () => repo.getBatch(a, batchId)))?.name).toBe("fixture");
  });

  it("without any tenant GUC the application role sees nothing", async () => {
    const a = newTenant();
    await insertBatchRow(a);
    const rows = await db.select().from(batches).where(eq(batches.tenantId, a));
    expect(rows).toHaveLength(0);
  });

  it("FORCE ROW LEVEL SECURITY + tenant_isolation policy on EVERY bulk_scan table", async () => {
    const rel = await db.execute(sql`
      SELECT c.relname AS name, c.relrowsecurity AS rls, c.relforcerowsecurity AS forced
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'bulk_scan' AND c.relkind = 'r' ORDER BY c.relname`);
    const names = (rel as unknown as { name: string; rls: boolean; forced: boolean }[]).map((r) => r.name);
    expect(names).toEqual(["batch_files", "batches", "file_events", "links", "profiles", "settings", "settings_change_requests"]);
    for (const r of rel as unknown as { name: string; rls: boolean; forced: boolean }[]) {
      expect(r.rls, r.name + " rls").toBe(true);
      expect(r.forced, r.name + " force rls").toBe(true);
    }
    const pol = await db.execute(sql`SELECT tablename, policyname, qual FROM pg_policies WHERE schemaname = 'bulk_scan' ORDER BY tablename`);
    const polRows = pol as unknown as { tablename: string; policyname: string; qual: string }[];
    expect(polRows.map((p) => p.tablename).sort()).toEqual(names);
    for (const p of polRows) {
      expect(p.policyname).toBe("tenant_isolation");
      expect(p.qual).toContain("current_tenant_id()");
    }
    const cols = await db.execute(sql`SELECT table_name FROM information_schema.columns WHERE table_schema = 'bulk_scan' AND column_name = 'tenant_id'`);
    expect((cols as unknown as { table_name: string }[]).map((c) => c.table_name).sort()).toEqual(names);
  });

  it("file_events is append-only for the service role; the app role is not a superuser/bypassrls", async () => {
    const t = newTenant();
    const b = await insertBatchRow(t);
    const f = await insertFileRow(t, b, "queued");
    await tenantTx(t, (tx) => repo.transition(tx, { tenantId: t, fileId: f, from: ["queued"], to: "skipped" }));
    // refused by the BEFORE UPDATE OR DELETE trigger when the app role OWNS the table (how CI migrates), or by missing privileges on an owner-mode database
    await expect(tenantTx(t, (tx) => tx.update(fileEvents).set({ reason: "tamper" }).where(eq(fileEvents.fileId, f)).then(() => undefined))).rejects.toThrow(/append-only|permission denied/);
    await expect(tenantTx(t, (tx) => tx.delete(fileEvents).where(eq(fileEvents.fileId, f)).then(() => undefined))).rejects.toThrow(/append-only|permission denied/);
    expect((await tenantTx(t, (tx) => tx.select().from(fileEvents).where(eq(fileEvents.fileId, f)))).length).toBeGreaterThan(0);   // untouched
    const trg = (await db.execute(sql`SELECT tgname FROM pg_trigger WHERE tgrelid = 'bulk_scan.file_events'::regclass AND NOT tgisinternal`)) as unknown as { tgname: string }[];
    expect(trg.map((x) => x.tgname)).toEqual(expect.arrayContaining(["trg_bulk_scan_file_events_append_only", "trg_bulk_scan_file_events_no_truncate"]));
    await expect(db.execute(sql`TRUNCATE bulk_scan.file_events`)).rejects.toThrow(/append-only|permission denied/);        // TRUNCATE is refused too (statement trigger / no privilege)
    const me = await db.execute(sql`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`);
    expect((me as unknown as { rolsuper: boolean; rolbypassrls: boolean }[])[0]).toEqual({ rolsuper: false, rolbypassrls: false });
  });

  it("the file state CHECK constraint matches state.ts exactly", async () => {
    const r = await db.execute(sql`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'bulk_scan_batch_files_state_chk'`);
    const def = (r as unknown as { def: string }[])[0]?.def ?? "";
    const inDb = [...def.matchAll(/'([a-z_]+)'/g)].map((m) => m[1] as string).sort();
    expect(inDb).toEqual([...FILE_STATES].sort());
  });

  it("drizzle schema columns match the migrated tables", async () => {
    const dbCols = await db.execute(sql`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'bulk_scan'`);
    const have = new Map<string, Set<string>>();
    for (const c of dbCols as unknown as { table_name: string; column_name: string }[]) {
      (have.get(c.table_name) ?? have.set(c.table_name, new Set()).get(c.table_name))?.add(c.column_name);
    }
    const tbls = { batches, batch_files: batchFiles, file_events: fileEvents, settings, settings_change_requests: settingsChangeRequests, profiles, links } as const;
    const { getTableConfig } = await import("drizzle-orm/pg-core");
    for (const [name, t] of Object.entries(tbls)) {
      const cfg = getTableConfig(t as never) as { columns: { name: string }[] };
      const mine = new Set(cfg.columns.map((c) => c.name));
      expect([...mine].sort(), name).toEqual([...(have.get(name) ?? [])].sort());
    }
  });
});

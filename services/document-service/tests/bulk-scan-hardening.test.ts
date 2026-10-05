/** Review-fix hardening: PII-free free-text reasons, complete-batch validation, sandbox OCR refusal, scanner DSN fail-fast. */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, and, inArray } from "drizzle-orm";
import { outboxMessages } from "@civitasone/outbox";
import { sqlClient, db } from "../src/shared/db.js";
import { COMMANDS } from "../src/topics.js";
import { setPorts, resetPorts } from "../src/modules/bulk-scan/ports.js";
import { links, fileEvents, batchFiles, settingsChangeRequests } from "../src/modules/bulk-scan/schema.js";
import { cloudMode } from "../src/modules/bulk-scan/ocr-adapter.js";
import { resolveScannerUrl } from "../src/shared/scanner-url.js";
import { USER1, USER2, newTenant, send, tenantTx, memoryStore, insertBatchRow, insertFileRow } from "./bulk-scan-helpers.js";
import { newInlineAll, useFiling, seedFile, seedFiled, getFileRow, auditsOf } from "./bulk-scan-review-helpers.js";

const store = memoryStore();
const { q } = newInlineAll();
const RAW = "Aadhaar 2341 2341 2346 phone 9876543210 mail a.b@example.com PAN ABCDE1234F";
// scrubReasonText masks to the last 4 characters (XXXX XXXX 2346): the raw values must be gone
const LEAK = /2341 ?2341|9876543210|a\.b@example|ABCDE1234F/;

beforeAll(() => { setPorts({ store }); useFiling(); });
afterEach(() => { vi.unstubAllEnvs(); store.objects.clear(); });
afterAll(async () => { resetPorts(); await sqlClient.end(); });

/** Everything this tenant's commands wrote to the outbox (audit events, link requests, domain events), as one string. */
const outboxText = async (t: string): Promise<string> =>
  JSON.stringify((await db.select().from(outboxMessages).where(eq(outboxMessages.tenantId, t))).map((r) => r.payload));
const eventsText = async (t: string, fileId: string): Promise<string> =>
  JSON.stringify(await tenantTx(t, (tx) => tx.select().from(fileEvents).where(eq(fileEvents.fileId, fileId))));

describe("free-text reasons are scrubbed on the document side", () => {
  it("review reject: file_events detail and the audit event carry no Aadhaar / phone / email / PAN", async () => {
    const t = newTenant();
    const s = await seedFile(store, t);
    await send(q, COMMANDS.bulkReviewReject, t, USER1, { fileId: s.fileId, expectedVersion: s.version, reason: "illegible " + RAW });
    expect(await eventsText(t, s.fileId)).not.toMatch(LEAK);
    expect(await eventsText(t, s.fileId)).toContain("illegible");
    const [ev] = await auditsOf(t, "review_rejected");
    expect(JSON.stringify(ev?.payload)).not.toMatch(LEAK);
    expect(JSON.stringify(ev?.payload)).toContain("illegible");
  });

  it("link reject: the stored link reason and the audit event are scrubbed", async () => {
    const t = newTenant();
    const d = await seedFiled(store, t, { link: "hr_employee", linkState: "awaiting_approval" });
    await send(q, COMMANDS.bulkLinkReject, t, USER2, { linkId: (await tenantTx(t, (tx) => tx.select().from(links)))[0]?.id, reason: "wrong person " + RAW });
    const row = (await tenantTx(t, (tx) => tx.select().from(links).where(eq(links.fileId, d.fileId))))[0];
    expect(row?.state).toBe("rejected");
    expect(row?.reason).not.toMatch(LEAK);
    expect(row?.reason).toContain("wrong person");
    expect(await outboxText(t)).not.toMatch(LEAK);
  });

  it("unlink: the stored reason, the unlink request sent to the target service and the audit event are scrubbed", async () => {
    const t = newTenant();
    await seedFiled(store, t, { link: "hr_employee" });
    const linkId = (await tenantTx(t, (tx) => tx.select().from(links)))[0]?.id as string;
    await send(q, COMMANDS.bulkLinkUnlink, t, USER2, { linkId, reason: "wrong employee " + RAW });
    expect((await tenantTx(t, (tx) => tx.select().from(links).where(eq(links.id, linkId))))[0]?.reason).not.toMatch(LEAK);
    const text = await outboxText(t);
    expect(text).not.toMatch(LEAK);
    expect(text).toContain("wrong employee");
  });

  it("operator skip / retry: file_events detail and audit are scrubbed", async () => {
    const t = newTenant();
    const b = await insertBatchRow(t);
    const skipId = await insertFileRow(t, b, "queued");
    await send(q, COMMANDS.bulkFileSkip, t, USER1, { fileId: skipId, reason: "paper copy " + RAW });
    expect(await eventsText(t, skipId)).not.toMatch(LEAK);
    const retryId = await insertFileRow(t, b, "failed", { failureReason: "SCAN_UNAVAILABLE", deadLetter: true });
    await send(q, COMMANDS.bulkFileRetry, t, USER1, { fileId: retryId, reason: "retry " + RAW });
    expect(await outboxText(t)).not.toMatch(LEAK);
    expect((await auditsOf(t, "file_skip"))).toHaveLength(1);
    expect((await auditsOf(t, "file_retry"))).toHaveLength(1);
  });

  it("settings change request: the stored reason is scrubbed", async () => {
    const t = newTenant();
    const id = randomUUID();
    await send(q, COMMANDS.bulkSettingsPropose, t, USER1, { requestId: id, settings: { malwareFailClosed: false }, reason: "scanner retired, ask 9876543210" }, id);
    const row = (await tenantTx(t, (tx) => tx.select().from(settingsChangeRequests).where(eq(settingsChangeRequests.id, id))))[0];
    expect(row?.reason).not.toMatch(/9876543210/);
    expect(row?.reason).toContain("scanner retired");
    expect(await outboxText(t)).not.toMatch(/9876543210/);
  });
});

describe("files.complete validates the payload batch id", () => {
  it("a file of another batch is left alone (still pending_upload, no failure recorded)", async () => {
    const t = newTenant();
    const b1 = await insertBatchRow(t), b2 = await insertBatchRow(t);
    const f = await insertFileRow(t, b1, "pending_upload");
    await send(q, COMMANDS.bulkFilesComplete, t, USER1, { batchId: b2, fileIds: [f] });
    expect((await getFileRow(t, f))?.state).toBe("pending_upload");
    // the right batch id still reaches the verification (object missing -> UPLOAD_MISSING)
    await send(q, COMMANDS.bulkFilesComplete, t, USER1, { batchId: b1, fileIds: [f] });
    expect((await getFileRow(t, f))).toMatchObject({ state: "failed", failureReason: "UPLOAD_MISSING" });
  });
});

describe("retention gaps: retry after a purge is refused", () => {
  it("a purged failed file cannot be retried (its objects are gone)", async () => {
    const t = newTenant();
    const b = await insertBatchRow(t);
    const f = await insertFileRow(t, b, "failed", { failureReason: "SCAN_UNAVAILABLE", retentionDeletedAt: new Date() });
    await expect(send(q, COMMANDS.bulkFileRetry, t, USER1, { fileId: f })).rejects.toThrow(/NOT_RETRYABLE/);
    expect((await tenantTx(t, (tx) => tx.select().from(batchFiles).where(and(eq(batchFiles.id, f), inArray(batchFiles.state, ["failed"])))))).toHaveLength(1);
  });
});

describe("OCR cloud sandbox mode is refused outside an explicit dev/test allowlist", () => {
  it("production, staging and an UNSET NODE_ENV refuse sandbox; development / test allow it; default is production", () => {
    vi.stubEnv("BULK_SCAN_OCR_CLOUD_MODE", "sandbox");
    for (const env of ["production", "staging", "prod", ""]) {
      vi.stubEnv("NODE_ENV", env);
      expect(() => cloudMode(), `NODE_ENV=${env}`).toThrow(/CLOUD_MODE_NOT_ALLOWED|refused/);
    }
    vi.stubEnv("NODE_ENV", undefined as unknown as string);
    delete process.env.NODE_ENV;
    expect(() => cloudMode()).toThrow(/refused/);
    for (const env of ["development", "test"]) { vi.stubEnv("NODE_ENV", env); expect(cloudMode()).toBe("sandbox"); }
    vi.stubEnv("BULK_SCAN_OCR_CLOUD_MODE", "");
    vi.stubEnv("NODE_ENV", "production");
    expect(cloudMode()).toBe("production");
  });
});

describe("scanner pool DSN resolution (fail fast, explicit allowlist)", () => {
  const DEV = { DATABASE_URL: "postgres://svc@h/db" };
  it("never falls back to DATABASE_URL outside development/test (production, staging, unset NODE_ENV all fail)", () => {
    for (const NODE_ENV of ["production", "staging", "", undefined]) {
      expect(() => resolveScannerUrl({ ...DEV, ...(NODE_ENV === undefined ? {} : { NODE_ENV }) } as NodeJS.ProcessEnv), String(NODE_ENV)).toThrow(/DOCUMENT_SCANNER_DATABASE_URL is required/);
    }
  });
  it("development / test may fall back to DATABASE_URL (the service role is RLS-inert there)", () => {
    for (const NODE_ENV of ["development", "test"]) expect(resolveScannerUrl({ ...DEV, NODE_ENV } as NodeJS.ProcessEnv)).toBe(DEV.DATABASE_URL);
    expect(() => resolveScannerUrl({ NODE_ENV: "test" } as NodeJS.ProcessEnv)).toThrow();
  });
  it("an explicit scanner DSN is used; outside dev/test it must differ from the service DSN", () => {
    const scanner = "postgres://document_scanner@h/db";
    expect(resolveScannerUrl({ ...DEV, DOCUMENT_SCANNER_DATABASE_URL: scanner, NODE_ENV: "production" } as NodeJS.ProcessEnv)).toBe(scanner);
    expect(resolveScannerUrl({ ...DEV, DOCUMENT_SCANNER_DATABASE_URL: scanner } as NodeJS.ProcessEnv)).toBe(scanner);
    expect(() => resolveScannerUrl({ ...DEV, DOCUMENT_SCANNER_DATABASE_URL: DEV.DATABASE_URL, NODE_ENV: "production" } as NodeJS.ProcessEnv)).toThrow(/must differ/);
  });
});

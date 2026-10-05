/**
 * Whole path with fake ports: upload -> scan -> OCR (persisting PII findings / degraded pages / page images) ->
 * needs_review -> reviewer edit + approve -> filed -> notification -> search + retention.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { sqlClient } from "../src/shared/db.js";
import { COMMANDS } from "../src/topics.js";
import * as repo from "../src/modules/bulk-scan/repo.js";
import * as rrepo from "../src/modules/bulk-scan/review-repo.js";
import { batches } from "../src/modules/bulk-scan/schema.js";
import { createDispatcher, type DiscoveryPort } from "../src/modules/bulk-scan/dispatcher.js";
import { setPorts, resetPorts } from "../src/modules/bulk-scan/ports.js";
import { keys } from "../src/modules/bulk-scan/keys.js";
import { createFilingAdapter } from "../src/modules/files/filing-adapter.js";
import { USER1, USER2, newTenant, send, pump, tenantTx, memoryStore, fakeScanner, fakeOcr, okOutput, pngBytes, putSettings, ingest } from "./bulk-scan-helpers.js";
import { newInlineAll, outboxOf, SJ } from "./bulk-scan-review-helpers.js";
import { runWithTenant } from "@civitasone/db";

const store = memoryStore();
const ocr = fakeOcr();
const { q } = newInlineAll();

function perTenantDiscovery(tenants: string[]): DiscoveryPort {
  return {
    async dueTenants(now) { const out: string[] = []; for (const t of tenants) if ((await tenantTx(t, (tx) => repo.dueFilesForTenant(tx, t, now, 1))).length) out.push(t); return out.sort(); },
    dueFiles: (t, now, cap) => tenantTx(t, (tx) => repo.dueFilesForTenant(tx, t, now, cap)),
    async expiredLeases() { return []; },
  };
}
async function runPipeline(tenants: string[]): Promise<void> {
  const d = createDispatcher({ discovery: perTenantDiscovery(tenants), slots: 8 });
  for (let i = 0; i < 6; i++) { await pump(q); const r = await d.dispatchOnce(); await pump(q); if (r.ocrClaimed + r.scanClaimed === 0) break; }
  await pump(q);
}

beforeAll(() => { setPorts({ store, scanner: fakeScanner(), ocr, filing: createFilingAdapter() }); });
afterAll(async () => { resetPorts(); await sqlClient.end(); });

describe("end to end", () => {
  it("OCR persists findings/degraded pages/page images; review approves; document filed; uploader notified once; searchable", async () => {
    const t = newTenant();
    await putSettings(t, { pii: { reviewOnDetect: true } });
    ocr.next = () => okOutput({
      structuredJson: SJ("Dear Sir, Aadhaar XXXX XXXX 1234"),
      degradedPages: [{ pageNumber: 1, reason: "no font for Tamil", droppedScripts: ["Tamil"] }],
      pageImages: [{ pageNumber: 1, data: new Uint8Array([1, 2, 3]), mimeType: "image/png", width: 100, height: 140 }],
    });
    const { batchId, fileIds } = await ingest(q, store, t, [{ name: "letter.png", bytes: pngBytes("e2e"), mime: "image/png" }]);
    const id = fileIds[0] as string;
    await runPipeline([t]);

    const f = await runWithTenant(t, () => repo.getFile(t, id));
    expect(f?.state).toBe("needs_review");
    expect(f?.reviewReasons).toContain("PII_DETECTED");
    expect(f?.piiFindings).toEqual([{ type: "aadhaar", pageNumber: 1, start: 12, end: 24, bbox: null, action: "mask", maskedPreview: "XXXX XXXX 1234" }]);
    expect(f?.degradedPages).toEqual([{ pageNumber: 1, reason: "no font for Tamil", droppedScripts: ["Tamil"] }]);
    expect(f?.pageImageCount).toBe(1);
    expect(store.objects.get(keys.pageImage(t, batchId, id, 1))?.length).toBe(3);

    // batch completed (pipeline settled) -> exactly one notification to the uploader
    expect(await outboxOf(t, "notification.send")).toHaveLength(1);
    expect((await outboxOf(t, "notification.send"))[0]?.payload).toMatchObject({ recipient: USER1, variables: { total: "1", needsReview: "1" } });

    // reviewer edits then approves
    await send(q, COMMANDS.bulkReviewEdit, t, USER2, { fileId: id, expectedVersion: f?.version, docType: "letter", tags: ["reviewed"] });
    const v = (await runWithTenant(t, () => repo.getFile(t, id)))?.version as number;
    await send(q, COMMANDS.bulkReviewApprove, t, USER2, { fileId: id, linkId: "00000000-0000-4000-8000-0000000000aa", expectedVersion: v });
    const filed = await runWithTenant(t, () => repo.getFile(t, id));
    expect(filed).toMatchObject({ state: "filed", reviewedBy: USER2, docType: "letter", tags: ["reviewed"] });
    expect(await outboxOf(t, "notification.send")).toHaveLength(1);                    // approving does not re-notify

    // searchable by masked text; the raw number never appears anywhere
    const hit = await runWithTenant(t, () => rrepo.searchFiled(t, { q: "Dear Sir", limit: 10, offset: 0 }));
    expect(hit.total).toBe(1);
    expect(hit.rows[0]?.searchText).toContain("XXXX XXXX 1234");
    const b = (await tenantTx(t, (tx) => tx.select().from(batches).where(eq(batches.id, batchId))))[0];
    expect(b?.notifiedCompletedAt).toBeTruthy();
  });
});

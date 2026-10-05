/**
 * (1) eOffice clearance gate on download / page image (fake estab HTTP server), (2) generic document_user stays denied,
 * (3) scan-link contract fixtures: what document-service publishes equals the fixtures and every fixture result is handled,
 * (4) batch notification text/variables, (5) imageUrl:null consistency.
 */
import { describe, it, expect, afterAll, beforeAll, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { LINK_TARGETS, LINK_TOPICS, TARGET_SERVICE, linkRequestSchema, unlinkRequestSchema, linkResultFixture, linkRequestFixture, unlinkRequestFixture, unlinkResultFixture, FIXTURE_IDS, scanLinkFixtures, type LinkTarget } from "@civitasone/scan-link";
import { eq } from "drizzle-orm";
import { queue } from "../src/shared/infra.js";
import { sqlClient } from "../src/shared/db.js";
import { COMMANDS } from "../src/topics.js";
import { registerBulkScanConsumers } from "../src/modules/bulk-scan/consumer.js";
import { registerReviewConsumers } from "../src/modules/bulk-scan/review-consumer.js";
import { setPorts, resetPorts } from "../src/modules/bulk-scan/ports.js";
import { resetLookupBreakers } from "../src/modules/bulk-scan/lookup-client.js";
import { summarizeBatch } from "../src/modules/bulk-scan/notify-consumer.js";
import { documentIdFor } from "../src/modules/bulk-scan/ids.js";
import { batches, links } from "../src/modules/bulk-scan/schema.js";
import { memoryStore, USER1, USER2, newTenant, send, tenantTx } from "./bulk-scan-helpers.js";
import { useFiling, seedFile, seedFiled, getFileRow, outboxOf, fakeServer, json, newInlineAll } from "./bulk-scan-review-helpers.js";

const SECRET = process.env.JWT_SECRET as string;
process.env.INTERNAL_SERVICE_SECRET = SECRET;
const P = "/v1/documents/bulk-scan";
const hdr = (sub: string, roles: string[], tid: string) => ({ authorization: `Bearer ${signToken({ sub, roles, tid } as never, SECRET)}`, "x-tenant-id": tid });
const store = memoryStore();
const { q: inline } = newInlineAll();
let app: Awaited<ReturnType<typeof import("../src/app.js").buildApp>>;

beforeAll(async () => {
  setPorts({ store }); useFiling();
  registerBulkScanConsumers(queue); registerReviewConsumers(queue);
  app = await (await import("../src/app.js")).buildApp();
});
afterEach(() => { vi.restoreAllMocks(); resetLookupBreakers(); store.objects.clear(); delete process.env.ESTAB_SERVICE_URL; delete process.env.BULK_SCAN_LOOKUP_TIMEOUT_MS; delete process.env.BULK_SCAN_LOOKUP_BREAKER_FAILURES; });
afterAll(async () => { resetPorts(); await app.close(); await sqlClient.end(); });

const call = async (url: string, h: Record<string, string>) => {
  const r = await app.inject({ method: "GET", url, headers: h });
  return { status: r.statusCode, body: r.body ? (JSON.parse(r.body) as Record<string, any>) : {} };
};
function spyAudit() {
  const real = queue.publish.bind(queue);
  const seen: unknown[] = [];
  vi.spyOn(queue, "publish").mockImplementation(async (topic: string, msg: any) => { if (topic === "audit.event.record") seen.push(msg); return real(topic, msg); });
  return seen;
}
async function addLink(t: string, s: { fileId: string; documentId: string }, target: string, state = "linked"): Promise<string> {
  const id = randomUUID();
  await tenantTx(t, (tx) => tx.insert(links).values({ id, tenantId: t, fileId: s.fileId, documentId: s.documentId, target, targetId: randomUUID(), state, requestedBy: USER1 }).then(() => undefined));
  return id;
}
const dl = (id: string) => `${P}/files/${id}/download`;
const pg = (id: string) => `${P}/files/${id}/pages/1/image`;

describe("eOffice clearance gate (fail closed)", () => {
  it("not cleared (reclassified file) -> 403 CLEARANCE_DENIED on download and page image; no audit, no presign", async () => {
    const t = newTenant();
    const d = await seedFiled(store, t, { link: "eoffice_file" });
    const estab = await fakeServer((req, res) => json(res, { data: { allowed: false, reason: "CLASSIFIED" } }));
    process.env.ESTAB_SERVICE_URL = estab.url;
    const audits = spyAudit();
    const presign = vi.spyOn(store, "presignGet");
    try {
      for (const u of [dl(d.documentId), pg(d.documentId)]) {
        const r = await call(u, hdr(USER2, ["estab_officer"], t));
        expect(r.status, u).toBe(403);
        expect(r.body.code).toBe("CLEARANCE_DENIED");
      }
      expect(audits).toHaveLength(0);
      expect(presign).not.toHaveBeenCalled();
    } finally { await estab.close(); }
  });

  it("cleared caller -> 200; estab is asked with the linked file id, the caller id and roles, service-account headers", async () => {
    const t = newTenant();
    const d = await seedFiled(store, t, { link: "eoffice_file" });
    const targetId = (await tenantTx(t, (tx) => tx.select().from(links)))[0]?.targetId;
    const estab = await fakeServer((req, res) => json(res, { data: { allowed: true, reason: null } }));
    process.env.ESTAB_SERVICE_URL = estab.url;
    try {
      const r = await call(dl(d.documentId), hdr(USER2, ["estab_officer", "audit_officer"], t));
      expect(r.status).toBe(200);
      expect(estab.hits).toHaveLength(1);
      const u = new URL("http://x" + estab.hits[0]?.url);
      expect(u.pathname).toBe("/internal/v1/scan-link/clearance");
      expect(u.searchParams.get("fileId")).toBe(targetId);
      expect(u.searchParams.get("userId")).toBe(USER2);
      expect(u.searchParams.get("roles")).toBe("estab_officer,audit_officer");
      expect(estab.hits[0]?.headers).toMatchObject({ "x-internal": "1", "x-tenant-id": t, "x-service-secret": SECRET, "x-internal-caller": "document-service" });
      expect((await call(pg(d.documentId), hdr(USER2, ["estab_officer"], t))).status).toBe(200);
    } finally { await estab.close(); }
  });

  it("estab down / 5xx / hanging / malformed -> 503 CLEARANCE_UNAVAILABLE, nothing served, nothing audited", async () => {
    const t = newTenant();
    const d = await seedFiled(store, t, { link: "eoffice_file" });
    const audits = spyAudit();
    const h = hdr(USER2, ["estab_officer"], t);
    process.env.BULK_SCAN_LOOKUP_TIMEOUT_MS = "300";
    process.env.ESTAB_SERVICE_URL = "http://127.0.0.1:1";
    let r = await call(dl(d.documentId), h);
    expect([r.status, r.body.code]).toEqual([503, "CLEARANCE_UNAVAILABLE"]);
    for (const [name, handler] of [
      ["500", (_q: unknown, res: any) => json(res, { error: "boom" }, 500)],
      ["404", (_q: unknown, res: any) => json(res, { error: "nf" }, 404)],
      ["shape", (_q: unknown, res: any) => json(res, { data: { allowed: "yes" } })],
      ["hang", () => { /* never answers */ }],
    ] as const) {
      resetLookupBreakers();
      const estab = await fakeServer(handler as never);
      process.env.ESTAB_SERVICE_URL = estab.url;
      try {
        const t0 = Date.now();
        r = await call(pg(d.documentId), h);
        expect([name, r.status, r.body.code]).toEqual([name, 503, "CLEARANCE_UNAVAILABLE"]);
        expect(Date.now() - t0).toBeLessThan(3000);
      } finally { await estab.close(); }
    }
    expect(audits).toHaveLength(0);
    expect(JSON.stringify(r.body)).not.toContain("s3.test");
  });

  it("document_admin and super_admin are clearance-checked too when the document has an active eOffice link (estab decides)", async () => {
    const t = newTenant();
    const d = await seedFiled(store, t, { link: "eoffice_file" });
    const targetId = (await tenantTx(t, (tx) => tx.select().from(links)))[0]?.targetId;
    const audits = spyAudit();
    const denyEstab = await fakeServer((_q, res) => json(res, { data: { allowed: false, reason: "CLASSIFIED" } }));
    process.env.ESTAB_SERVICE_URL = denyEstab.url;
    try {
      for (const role of ["document_admin", "super_admin"]) {
        for (const u of [dl(d.documentId), pg(d.documentId)]) {
          const r = await call(u, hdr(USER1, [role], t));
          expect([role, r.status, r.body.code]).toEqual([role, 403, "CLEARANCE_DENIED"]);
        }
      }
      expect(denyEstab.hits).toHaveLength(4);
      expect(new URL("http://x" + denyEstab.hits[0]?.url).searchParams.get("fileId")).toBe(targetId);
      expect(audits).toHaveLength(0);
    } finally { await denyEstab.close(); }
    const okEstab = await fakeServer((_q, res) => json(res, { data: { allowed: true, reason: null } }));
    process.env.ESTAB_SERVICE_URL = okEstab.url;
    try {
      expect((await call(dl(d.documentId), hdr(USER1, ["document_admin"], t))).status).toBe(200);
      expect(okEstab.hits).toHaveLength(1);
    } finally { await okEstab.close(); }
    process.env.ESTAB_SERVICE_URL = "http://127.0.0.1:1";
    process.env.BULK_SCAN_LOOKUP_TIMEOUT_MS = "300";
    resetLookupBreakers();
    expect((await call(dl(d.documentId), hdr(USER1, ["super_admin"], t))).body.code).toBe("CLEARANCE_UNAVAILABLE");   // fail closed
  });

  it("documented side effect: a document_admin WITHOUT an estab reader role (estab answers FORBIDDEN_ROLE) cannot download eOffice-linked documents, including ones they filed", async () => {
    const t = newTenant();
    const d = await seedFiled(store, t, { link: "eoffice_file" });
    const estab = await fakeServer((_q, res) => json(res, { data: { allowed: false, reason: "FORBIDDEN_ROLE" } }));
    process.env.ESTAB_SERVICE_URL = estab.url;
    try {
      const r = await call(dl(d.documentId), hdr(USER1, ["document_admin"], t));
      expect([r.status, r.body.code]).toEqual([403, "CLEARANCE_DENIED"]);
      expect(estab.hits).toHaveLength(1);
      // the same user can still download the document once the link is not an eOffice link (no estab involved)
      const hr = await seedFiled(store, t, { link: "hr_employee" });
      expect((await call(dl(hr.documentId), hdr(USER1, ["document_admin"], t))).status).toBe(200);
      expect(estab.hits).toHaveLength(1);
    } finally { await estab.close(); }
  });

  it("the circuit breaker opens after repeated failures (estab is no longer hammered)", async () => {
    const t = newTenant();
    const d = await seedFiled(store, t, { link: "eoffice_file" });
    const estab = await fakeServer((_q, res) => json(res, {}, 500));
    process.env.ESTAB_SERVICE_URL = estab.url;
    process.env.BULK_SCAN_LOOKUP_BREAKER_FAILURES = "2";
    try {
      for (let i = 0; i < 4; i++) expect((await call(dl(d.documentId), hdr(USER2, ["estab_officer"], t))).status).toBe(503);
      expect(estab.hits).toHaveLength(2);
    } finally { await estab.close(); }
  });

  it("access via a non-eOffice link never calls estab; HR / finance documents are unaffected, and so are document roles on non-eOffice documents", async () => {
    const t = newTenant();
    const estab = await fakeServer((_q, res) => json(res, { data: { allowed: false, reason: "CLASSIFIED" } }));
    process.env.ESTAB_SERVICE_URL = estab.url;
    try {
      const hr = await seedFiled(store, t, { link: "hr_employee" });
      const fin = await seedFiled(store, t, { link: "finance_voucher" });
      expect((await call(dl(hr.documentId), hdr(USER1, ["document_admin"], t))).status).toBe(200);          // document role, no eOffice link
      expect((await call(dl(fin.documentId), hdr(USER1, ["super_admin"], t))).status).toBe(200);
      expect((await call(dl(hr.documentId), hdr(USER2, ["hr_officer"], t))).status).toBe(200);
      expect((await call(dl(fin.documentId), hdr(USER2, ["finance_officer"], t))).status).toBe(200);
      expect(estab.hits).toHaveLength(0);
      // several links: the gate applies only to access granted THROUGH the eOffice link
      const multi = await seedFiled(store, t, { link: "eoffice_file" });
      await addLink(t, multi, "finance_voucher");
      expect((await call(dl(multi.documentId), hdr(USER2, ["finance_officer"], t))).status).toBe(200);      // granted by the finance link
      expect(estab.hits).toHaveLength(0);
      expect((await call(dl(multi.documentId), hdr(USER2, ["estab_officer"], t))).body.code).toBe("CLEARANCE_DENIED");   // only the eOffice link grants
      expect(estab.hits).toHaveLength(1);
      expect((await call(dl(multi.documentId), hdr(USER2, ["hr_officer"], t))).body.code).toBe("FORBIDDEN");   // no granting link at all
    } finally { await estab.close(); }
  });

  it("several eOffice links: any one that clears grants access", async () => {
    const t = newTenant();
    const d = await seedFiled(store, t, { link: "eoffice_file" });
    const second = await addLink(t, d, "eoffice_file");
    const secondTarget = (await tenantTx(t, (tx) => tx.select().from(links).where(eq(links.id, second))))[0]?.targetId;
    const estab = await fakeServer((req, res) => json(res, { data: { allowed: (req.url ?? "").includes(secondTarget ?? "?"), reason: null } }));
    process.env.ESTAB_SERVICE_URL = estab.url;
    try { expect((await call(dl(d.documentId), hdr(USER2, ["estab_officer"], t))).status).toBe(200); } finally { await estab.close(); }
  });
});

describe("generic document_user stays denied", () => {
  it("document_user cannot download, view a page, search, read the review queue or links - even for a linked / bare document", async () => {
    const t = newTenant();
    const d = await seedFiled(store, t, { link: "hr_employee" });
    const bare = await seedFiled(store, t);
    const h = hdr(USER2, ["document_user"], t);
    for (const u of [dl(d.documentId), dl(bare.documentId), pg(d.documentId), `${P}/search?q=voucher`, `${P}/review-queue`, `${P}/links`, `${P}/providers`]) {
      expect((await call(u, h)).status, u).toBe(403);
    }
  });
});

describe("page images: imageUrl null handled consistently", () => {
  it("a file with no stored page image: review pages carry imageUrl null AND the page-image route answers 404", async () => {
    const t = newTenant();
    const s = await seedFile(store, t, "needs_review", { pageImageCount: 0 });
    const rev = await call(`${P}/batches/${s.batchId}/files/${s.fileId}/review`, hdr(USER1, ["document_admin"], t));
    expect(rev.status).toBe(200);
    expect(rev.body.pages.every((p: { imageUrl: unknown }) => p.imageUrl === null)).toBe(true);
    const d = await seedFiled(store, t, { pageImages: 0 });
    expect((await call(pg(d.documentId), hdr(USER1, ["document_admin"], t))).status).toBe(404);
    const withImg = await seedFiled(store, t, { pageImages: 1 });
    expect((await call(pg(withImg.documentId), hdr(USER1, ["document_admin"], t))).status).toBe(200);
  });
});

// ── contract fixtures ───────────────────────────────────────────

const approve = (t: string, actor: string, fileId: string, version: number, link: { target: string; targetId: string }, messageId: string) =>
  send(inline, COMMANDS.bulkReviewApprove, t, actor, { fileId, linkId: messageId, expectedVersion: version, link }, messageId);

/** needs_review file -> link approved by a checker -> request published (requestedBy USER1, approvedBy USER2 = the fixture ids). */
async function requestedLink(target: LinkTarget) {
  const t = newTenant();
  const s = await seedFile(store, t);
  const linkId = randomUUID();
  await approve(t, USER1, s.fileId, s.version, { target, targetId: FIXTURE_IDS.targetId }, linkId);
  await send(inline, COMMANDS.bulkLinkApprove, t, USER2, { linkId });
  return { t, s, linkId, documentId: documentIdFor(s.fileId) };
}
const svc = (t: LinkTarget) => TARGET_SERVICE[t];
const result = (t: string, target: LinkTarget, payload: unknown) => send(inline, LINK_TOPICS.result(svc(target)), t, USER1, payload);
const linkState = async (t: string, id: string) => (await tenantTx(t, (tx) => tx.select().from(links).where(eq(links.id, id))))[0]?.state;

describe("scan-link contract fixtures", () => {
  it("fixtures parse with the package schemas for every target", () => {
    for (const [target, f] of Object.entries(scanLinkFixtures())) {
      expect(linkRequestSchema.parse(f.request).target).toBe(target);
      expect(unlinkRequestSchema.parse(f.unlinkRequest).target).toBe(target);
      expect(Object.keys(f.results).sort()).toEqual(["flagged_mismatch", "linked", "rejected"]);
    }
  });

  it.each(LINK_TARGETS)("%s: the published link request and unlink request equal the fixture shape (only ids/timestamps/content differ)", async (target) => {
    const { t, s, linkId, documentId } = await requestedLink(target);
    const [req] = await outboxOf(t, LINK_TOPICS.request(svc(target)));
    const actual = linkRequestSchema.parse(req?.payload);
    const fx = linkRequestFixture(target);
    const expected = linkRequestFixture(target, {
      linkId,
      document: { ...fx.document, documentId, batchId: s.batchId, filedAt: actual.document.filedAt, fileName: "voucher.pdf", docType: "bill_voucher", pageCount: 1, ocrConfidence: 0.9, textPreviewMasked: actual.document.textPreviewMasked },
    });
    expect(actual).toEqual(expected);
    expect(Object.keys(actual).sort()).toEqual(Object.keys(fx).sort());                       // same key set as the pure fixture (financeHint iff finance)
    expect("financeHint" in actual).toBe(target.startsWith("finance_"));

    await result(t, target, linkResultFixture(target, "linked", { linkId, documentId }));
    await send(inline, COMMANDS.bulkLinkUnlink, t, USER1, { linkId, reason: "attached to the wrong record" });
    const [un] = await outboxOf(t, LINK_TOPICS.unlinkRequest(svc(target)));
    expect(unlinkRequestSchema.parse(un?.payload)).toEqual(unlinkRequestFixture(target, { linkId, documentId }));
  });

  it.each(LINK_TARGETS)("%s: every fixture result reaches the expected state", async (target) => {
    for (const [status, link, file] of [["linked", "linked", "filed"], ["rejected", "rejected", "needs_review"], ["flagged_mismatch", "flagged_mismatch", "needs_review"]] as const) {
      const { t, s, linkId, documentId } = await requestedLink(target);
      await result(t, target, linkResultFixture(target, status, { linkId, documentId }));
      expect([status, await linkState(t, linkId), (await getFileRow(t, s.fileId))?.state]).toEqual([status, link, file]);
    }
  });

  it.each(LINK_TARGETS)("%s: every fixture unlink result reaches the expected state", async (target) => {
    for (const [status, expected] of [["unlinked", "unlinked"], ["rejected", "linked"]] as const) {
      const { t, linkId, documentId } = await requestedLink(target);
      await result(t, target, linkResultFixture(target, "linked", { linkId, documentId }));
      await send(inline, COMMANDS.bulkLinkUnlink, t, USER1, { linkId, reason: "attached to the wrong record" });
      await send(inline, LINK_TOPICS.unlinkResult(svc(target)), t, USER1, unlinkResultFixture(status, { linkId, documentId }));
      expect([status, await linkState(t, linkId)]).toEqual([status, expected]);
    }
  });
});

// ── notification ────────────────────────────────────────────────

describe("batch notification text", () => {
  const completeBatch = (t: string, batchId: string) => tenantTx(t, (tx) => tx.update(batches).set({ status: "completed", completedAt: new Date(), fileCount: 2 }).where(eq(batches.id, batchId)).then(() => undefined));

  it("a batch with needs_review files: allSettled=false and the text never says done/complete", async () => {
    const t = newTenant();
    const s = await seedFile(store, t);
    await completeBatch(t, s.batchId);
    await send(inline, "document.bulkscan.batch.completed", t, USER1, { batchId: s.batchId });
    const [n] = await outboxOf(t, "notification.send");
    expect(n?.payload.variables).toMatchObject({ allSettled: "false", needsReview: "1", filed: "0", failed: "0", quarantined: "0", skipped: "0", total: "1" });
    expect(String(n?.payload.body)).toMatch(/waiting for your review/);
    expect(String(n?.payload.body)).not.toMatch(/done|complete/i);
  });

  it("a fully filed batch: allSettled=true and the text says everything is settled", async () => {
    const t = newTenant();
    const s = await seedFile(store, t);
    await send(inline, COMMANDS.bulkReviewApprove, t, USER1, { fileId: s.fileId, linkId: randomUUID(), expectedVersion: s.version });
    await completeBatch(t, s.batchId);
    await send(inline, "document.bulkscan.batch.completed", t, USER1, { batchId: s.batchId });
    const [n] = await outboxOf(t, "notification.send");
    expect(n?.payload.variables).toMatchObject({ allSettled: "true", filed: "1", needsReview: "0", total: "1" });
    expect(String(n?.payload.body)).toMatch(/settled/);
  });

  it("summarizeBatch: in-progress / ready_to_file / failed / quarantined / skipped counts and wording", () => {
    const a = summarizeBatch("B1", { filed: 2, scanning: 1, ready_to_file: 1, failed: 1, quarantined: 1, skipped: 1, cancelled: 1, skipped_duplicate: 1 });
    expect(a.allSettled).toBe(false);
    expect(a.variables).toMatchObject({ total: "9", filed: "2", failed: "1", quarantined: "1", skipped: "3", readyToFile: "1", allSettled: "false", batchName: "B1" });
    expect(a.body).toMatch(/still being processed/);
    expect(a.body).not.toMatch(/done|complete/i);
    const b = summarizeBatch("B2", { filed: 3, failed: 1, skipped: 2 });
    expect(b.allSettled).toBe(true);                                                           // failed is terminal-until-retried: not blocking
    expect(b.body).toMatch(/settled/);
  });
});

describe("shared reason vocabulary: code + detail", () => {
  it("stores the reason CODE and PII-free detail; /links and the review view return both; LINK_<code> review reason; free text is refused", async () => {
    const { t, s, linkId, documentId } = await requestedLink("finance_voucher");
    const detail = { expectedMinor: "150000", scannedMinor: "160000" };
    await result(t, "finance_voucher", linkResultFixture("finance_voucher", "flagged_mismatch", { linkId, documentId, reason: "AMOUNT_MISMATCH", detail }));
    const row = (await tenantTx(t, (tx) => tx.select().from(links).where(eq(links.id, linkId))))[0];
    expect(row).toMatchObject({ state: "flagged_mismatch", resultReason: "AMOUNT_MISMATCH", resultDetail: detail });
    expect((await getFileRow(t, s.fileId))?.reviewReasons).toContain("LINK_AMOUNT_MISMATCH");
    const h = hdr(USER1, ["document_admin"], t);
    const l = (await call(`${P}/links?state=flagged_mismatch`, h)).body.data[0];
    expect(l).toMatchObject({ linkId, reason: "AMOUNT_MISMATCH", resultReason: "AMOUNT_MISMATCH", detail });
    const rev = await call(`${P}/batches/${s.batchId}/files/${s.fileId}/review`, h);
    expect(rev.body.links[0]).toMatchObject({ linkId, reason: "AMOUNT_MISMATCH", detail });
    await expect(result(t, "finance_voucher", { ...linkResultFixture("finance_voucher", "rejected"), reason: "the amount is wrong" })).rejects.toThrow(/INVALID_LINK_RESULT/);
  });

  it("an unlink refusal keeps code + detail on the link", async () => {
    const { t, linkId, documentId } = await requestedLink("hr_employee");
    await result(t, "hr_employee", linkResultFixture("hr_employee", "linked", { linkId, documentId }));
    await send(inline, COMMANDS.bulkLinkUnlink, t, USER1, { linkId, reason: "attached to the wrong record" });
    await send(inline, LINK_TOPICS.unlinkResult("hrms"), t, USER1, unlinkResultFixture("rejected", { linkId, documentId, reason: "LINK_NOT_FOUND", detail: { attempt: 1 } }));
    expect((await tenantTx(t, (tx) => tx.select().from(links).where(eq(links.id, linkId))))[0]).toMatchObject({ state: "linked", resultReason: "LINK_NOT_FOUND", resultDetail: { attempt: 1 } });
  });
});

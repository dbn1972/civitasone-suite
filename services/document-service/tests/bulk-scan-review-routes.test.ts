/** Review / links / download / search / providers over HTTP (real DB + real memory queue + consumers). */
import { describe, it, expect, afterAll, beforeAll, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { queue } from "../src/shared/infra.js";
import { sqlClient } from "../src/shared/db.js";
import { registerBulkScanConsumers } from "../src/modules/bulk-scan/consumer.js";
import { registerReviewConsumers } from "../src/modules/bulk-scan/review-consumer.js";
import { registerLinkResultConsumers } from "../src/modules/bulk-scan/link-consumer.js";
import { setPorts, resetPorts } from "../src/modules/bulk-scan/ports.js";
import { resetLookupBreakers } from "../src/modules/bulk-scan/lookup-client.js";
import { resetProvidersCache } from "../src/modules/bulk-scan/providers.js";
import { memoryStore, putSettings, USER1, USER2, newTenant, tenantTx } from "./bulk-scan-helpers.js";
import { useFiling, seedFile, seedFiled, getFileRow, fakeServer, json, type FakeServer } from "./bulk-scan-review-helpers.js";
import { links } from "../src/modules/bulk-scan/schema.js";

const SECRET = process.env.JWT_SECRET as string;
process.env.INTERNAL_SERVICE_SECRET = SECRET;
const P = "/v1/documents/bulk-scan";
const hdr = (sub: string, roles: string[], tid: string) => ({ authorization: `Bearer ${signToken({ sub, roles, tid } as never, SECRET)}`, "x-tenant-id": tid });
const admin = (t: string, sub = USER1) => hdr(sub, ["document_admin"], t);

const store = memoryStore();
let app: Awaited<ReturnType<typeof import("../src/app.js").buildApp>>;
const FIN = "11111111-1111-4111-8111-111111111111";

beforeAll(async () => {
  setPorts({ store });
  useFiling();
  registerBulkScanConsumers(queue);
  registerReviewConsumers(queue);
  registerLinkResultConsumers(queue);
  const { buildApp } = await import("../src/app.js");
  app = await buildApp();
});
afterEach(() => { vi.restoreAllMocks(); resetLookupBreakers(); resetProvidersCache(); store.objects.clear(); });
afterAll(async () => { resetPorts(); await app.close(); await sqlClient.end(); });

const call = async (method: "GET" | "POST", url: string, h: Record<string, string>, payload?: unknown) => {
  const r = await app.inject({ method, url, headers: h, ...(payload === undefined ? {} : { payload: payload as never }) });
  await queue.drain();
  return { status: r.statusCode, body: r.body ? (JSON.parse(r.body) as Record<string, any>) : {} };
};

/** Spy on queue.publish: record audit events; optionally make the audit publish fail. */
function spyAudit(fail = false) {
  const real = queue.publish.bind(queue);
  const seen: { tenantId: string; actorId: string; payload: Record<string, any> }[] = [];
  vi.spyOn(queue, "publish").mockImplementation(async (topic: string, msg: any) => {
    if (topic === "audit.event.record") {
      if (fail) throw new Error("queue down");
      seen.push({ tenantId: msg.tenantId, actorId: msg.actorId, payload: msg.payload });
    }
    return real(topic, msg);
  });
  return seen;
}

describe("access control", () => {
  it("every new route needs auth and an admin role", async () => {
    const t = newTenant();
    const s = await seedFile(store, t);
    const urls: [string, string][] = [
      ["GET", `${P}/review-queue`], ["GET", `${P}/batches/${s.batchId}/files/${s.fileId}/review`], ["GET", `${P}/links`],
      ["GET", `${P}/link-lookup?target=hr_employee&q=ab`], ["GET", `${P}/search?q=ab`], ["GET", `${P}/providers`],
    ];
    for (const [m, u] of urls) {
      expect((await app.inject({ method: m as "GET", url: u })).statusCode, "unauth " + u).toBe(401);
      expect((await call("GET", u, hdr(USER1, ["document_user"], t))).status, "user " + u).toBe(403);
    }
    for (const act of ["edit", "approve", "reject"]) {
      expect((await call("POST", `${P}/batches/${s.batchId}/files/${s.fileId}/review/${act}`, hdr(USER1, ["document_user"], t), {})).status, act).toBe(403);
    }
    expect((await call("GET", `${P}/review-queue`, admin(t))).status).toBe(200);
  });
});

describe("review queue", () => {
  it("lists needs_review files with reasons, paginates, filters by reason, is tenant scoped", async () => {
    const t = newTenant(), other = newTenant();
    const a = await seedFile(store, t), b = await seedFile(store, t, "needs_review", { reviewReasons: ["LOW_CONFIDENCE", "MISSING_FIELD:date"] });
    await seedFile(store, t, "ready_to_file");                       // not in the queue
    await seedFile(store, other);                                    // other tenant
    const all = await call("GET", `${P}/review-queue`, admin(t));
    expect(all.body.pagination).toEqual({ total: 2, limit: 50, offset: 0 });
    expect(all.body.data.map((x: any) => x.fileId).sort()).toEqual([a.fileId, b.fileId].sort());
    const row = all.body.data.find((x: any) => x.fileId === b.fileId);
    expect(row).toMatchObject({ batchId: b.batchId, originalName: "voucher.pdf", docType: "bill_voucher", reasons: ["LOW_CONFIDENCE", "MISSING_FIELD:date"], piiFlags: ["aadhaar"], pageCount: 1, degradedPages: 1, version: b.version });
    expect(row.confidence).toBeCloseTo(0.9);
    expect((await call("GET", `${P}/review-queue?limit=1&offset=1`, admin(t))).body).toMatchObject({ pagination: { total: 2, limit: 1, offset: 1 } });
    expect((await call("GET", `${P}/review-queue?reason=MISSING_FIELD`, admin(t))).body.data.map((x: any) => x.fileId)).toEqual([b.fileId]);   // parameterised reason prefix
    expect((await call("GET", `${P}/review-queue?reason=PII_DETECTED`, admin(t))).body.data.map((x: any) => x.fileId)).toEqual([a.fileId]);
    expect((await call("GET", `${P}/review-queue?limit=0`, admin(t))).status).toBe(400);
  });
});

describe("review detail + audit-on-read", () => {
  const route = "GET /v1/documents/bulk-scan/batches/:batchId/files/:fileId/review";

  it("returns masked pages/words/fields, presigned page images, classification (top-2), PII findings, doc types; audits the view once with only the permitted fields", async () => {
    const t = newTenant();
    const s = await seedFile(store, t);
    const audits = spyAudit();
    const r = await call("GET", `${P}/batches/${s.batchId}/files/${s.fileId}/review`, admin(t));
    expect(r.status).toBe(200);
    const b = r.body;
    expect(b.file).toMatchObject({ id: s.fileId, version: s.version, state: "needs_review" });
    expect(b.file).not.toHaveProperty("extractedFields");
    expect(b.pages).toHaveLength(1);
    expect(b.pages[0]).toMatchObject({ pageNumber: 1, meanConfidence: 0.9, orientationDeg: 0, script: "Latin", width: 300, height: 40 });
    expect(b.pages[0].imageUrl).toMatch(/^https:\/\/s3\.test\/get\/.*derived\/pages\/1\?/);
    expect(b.pages[0].text).toContain("XXXX XXXX 1234");
    expect(b.pages[0].words[0]).toMatchObject({ text: "Dear", bbox: { x0: 0, x1: 40 } });
    expect(JSON.stringify(b)).not.toMatch(/123412341234/);
    expect(b.fields.find((f: any) => f.kind === "aadhaar").value).toBe("XXXXXXXX1234");           // PII field masked even if stored clear
    expect(b.fields.find((f: any) => f.kind === "voucher_no").value).toBe("V-100");
    // addendum: classification {docType,confidence,evidence,uncertain,presetDocType,candidates top-2}
    expect(b.classification).toEqual({
      docType: "bill_voucher", confidence: 0.8, evidence: ["kw:voucher"], uncertain: false, presetDocType: "letter",
      candidates: [{ docType: "bill_voucher", label: "Bill / voucher", score: 0.8 }, { docType: "letter", label: "Letter", score: 0.3 }],
    });
    expect(b.piiFindings).toEqual([{ type: "aadhaar", pageNumber: 1, start: 52, end: 66, bbox: null, action: "mask", maskedPreview: "XXXX XXXX 1234" }]);
    expect(b.degradedPages).toEqual([{ pageNumber: 1, reason: "no font", droppedScripts: ["Tamil"] }]);
    expect(b.docTypes.find((d: any) => d.id === "letter")).toEqual({ id: "letter", label: "Letter" });
    expect(b.reasons).toEqual(["PII_DETECTED"]);
    expect(b.linkSuggestions).toEqual([]);                                                          // no target service reachable / no ids -> graceful
    // exactly ONE audit event, only actor / document / purpose / route
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ tenantId: t, actorId: USER1 });
    expect(audits[0]?.payload).toEqual({
      service: "document", action: "bulk_scan_review_view", resourceType: "document", resourceId: expect.any(String), outcome: "success",
      details: { purpose: "review_view", route },
    });
    expect(JSON.stringify(audits[0])).not.toMatch(/Dear|voucher|XXXX|V-100/);
  });

  it("fails closed: if the audit publish fails the view is a 500, no content, storage never read", async () => {
    const t = newTenant();
    const s = await seedFile(store, t);
    const getSpy = vi.spyOn(store, "get");
    spyAudit(true);
    const r = await call("GET", `${P}/batches/${s.batchId}/files/${s.fileId}/review`, admin(t));
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.body)).not.toMatch(/Dear|voucher|pages|fields/);
    expect(getSpy).not.toHaveBeenCalled();
  });

  it("404 for a wrong batch / unknown file / other tenant, 409 for a file not in review; none of them audited", async () => {
    const t = newTenant(), other = newTenant();
    const s = await seedFile(store, t), f = await seedFile(store, t, "ready_to_file", { state: "filed" });
    const audits = spyAudit();
    expect((await call("GET", `${P}/batches/${randomUUID()}/files/${s.fileId}/review`, admin(t))).status).toBe(404);
    expect((await call("GET", `${P}/batches/${s.batchId}/files/${randomUUID()}/review`, admin(t))).status).toBe(404);
    expect((await call("GET", `${P}/batches/${s.batchId}/files/${s.fileId}/review`, admin(other))).status).toBe(404);
    expect((await call("GET", `${P}/batches/${f.batchId}/files/${f.fileId}/review`, admin(t))).status).toBe(409);
    expect(audits).toHaveLength(0);
  });

  it("link suggestions come from the target services (reference+amount -> finance, employee no -> HR), failures degrade to none", async () => {
    const t = newTenant();
    const s = await seedFile(store, t, "needs_review", { extractedFields: [
      { kind: "voucher_no", value: "V-100", raw: "V-100", confidence: 0.9, pageNumber: 1, bbox: null },
      { kind: "amount_inr", value: "150000", raw: "1,500.00", confidence: 0.9, pageNumber: 1, bbox: null },
      { kind: "employee_no", value: "E-42", raw: "E-42", confidence: 0.9, pageNumber: 1, bbox: null },
    ] });
    const fin = await fakeServer((req, res) => json(res, { data: [{ target: "finance_voucher", targetId: FIN, label: "VCH-2026-1", amountMinor: "160000", reference: "V-100", confidence: 0.7, requestedAmountMinor: "150000", amountMatches: false }] }));
    const hr = await fakeServer((req, res) => json(res, { data: [{ target: "hr_employee", targetId: "22222222-2222-4222-8222-222222222222", label: "E-42 - R Kumar", amountMinor: null, reference: null, confidence: 1 }] }));
    process.env.FINANCE_SERVICE_URL = fin.url; process.env.HRMS_SERVICE_URL = hr.url; process.env.ESTAB_SERVICE_URL = "http://127.0.0.1:1";
    try {
      const r = await call("GET", `${P}/batches/${s.batchId}/files/${s.fileId}/review`, admin(t));
      expect(r.body.linkSuggestions).toEqual([
        { target: "hr_employee", targetId: "22222222-2222-4222-8222-222222222222", label: "E-42 - R Kumar", confidence: 1 },
        { target: "finance_voucher", targetId: FIN, label: "VCH-2026-1", confidence: 0.7, amountMinor: "160000", reference: "V-100", mismatch: true },
      ]);
      const h = fin.hits[0];
      expect(h?.url).toContain("reference=V-100");
      expect(h?.url).toContain("amountMinor=150000");
      expect(h?.headers).toMatchObject({ "x-internal": "1", "x-tenant-id": t, "x-service-secret": SECRET });
    } finally { await fin.close(); await hr.close(); delete process.env.FINANCE_SERVICE_URL; delete process.env.HRMS_SERVICE_URL; delete process.env.ESTAB_SERVICE_URL; }
  });
});

describe("edit / approve / reject over HTTP", () => {
  const base = (s: { batchId: string; fileId: string }) => `${P}/batches/${s.batchId}/files/${s.fileId}/review`;

  it("edit: 202, version conflict 409 STALE, 422 for unknown doc type / bad value, 400 for an empty edit, 404 wrong batch", async () => {
    const t = newTenant();
    const s = await seedFile(store, t);
    const ok = await call("POST", base(s) + "/edit", admin(t), { expectedVersion: s.version, tags: ["q"] });
    expect(ok.status).toBe(202);
    expect(ok.body).toMatchObject({ status: "accepted" });
    expect((await getFileRow(t, s.fileId))?.tags).toEqual(["q"]);
    const stale = await call("POST", base(s) + "/edit", admin(t, USER2), { expectedVersion: s.version, tags: ["z"] });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe("STALE");
    const v = (await getFileRow(t, s.fileId))?.version ?? 0;
    expect((await call("POST", base(s) + "/edit", admin(t), { expectedVersion: v, docType: "nope" })).status).toBe(422);
    expect((await call("POST", base(s) + "/edit", admin(t), { expectedVersion: v, fields: [{ kind: "date", value: "x" }] })).body.code).toBe("INVALID_FIELD_VALUE");
    expect((await call("POST", base(s) + "/edit", admin(t), { expectedVersion: v })).status).toBe(400);
    expect((await call("POST", `${P}/batches/${randomUUID()}/files/${s.fileId}/review/edit`, admin(t), { expectedVersion: v, tags: ["a"] })).status).toBe(404);
  });

  it("approve without a link files the document; a second approve is refused (409)", async () => {
    const t = newTenant();
    const s = await seedFile(store, t);
    expect((await call("POST", base(s) + "/approve", admin(t), { expectedVersion: s.version })).status).toBe(202);
    expect((await getFileRow(t, s.fileId))?.state).toBe("filed");
    expect((await call("POST", base(s) + "/approve", admin(t), { expectedVersion: s.version })).status).toBe(409);
  });

  it("approve with a link: 422 when the target is disabled, 422 for a malformed id, 202 + awaiting_approval otherwise", async () => {
    const t = newTenant();
    await putSettings(t, { allowedLinkTargets: ["hr_employee"] });
    const s = await seedFile(store, t);
    const dis = await call("POST", base(s) + "/approve", admin(t), { expectedVersion: s.version, link: { target: "finance_bill", targetId: FIN } });
    expect(dis.status).toBe(422);
    expect(dis.body.code).toBe("LINK_TARGET_NOT_ALLOWED");
    expect((await call("POST", base(s) + "/approve", admin(t), { expectedVersion: s.version, link: { target: "hr_employee", targetId: "x" } })).body.code).toBe("INVALID_LINK_TARGET");
    const ok = await call("POST", base(s) + "/approve", admin(t), { expectedVersion: s.version, link: { target: "hr_employee", targetId: FIN } });
    expect(ok.status).toBe(202);
    const l = await call("GET", `${P}/links?state=awaiting_approval`, admin(t));
    expect(l.body.data).toHaveLength(1);
    expect(l.body.data[0]).toMatchObject({ linkId: ok.body.id, fileId: s.fileId, target: "hr_employee", targetId: FIN, state: "awaiting_approval", requestedBy: USER1, approvedBy: null });
    expect((await getFileRow(t, s.fileId))?.state).toBe("ready_to_file");
  });

  it("reject: needs a reason (400), then 202 -> skipped", async () => {
    const t = newTenant();
    const s = await seedFile(store, t);
    expect((await call("POST", base(s) + "/reject", admin(t), { expectedVersion: s.version, reason: "no" })).status).toBe(400);
    expect((await call("POST", base(s) + "/reject", admin(t), { expectedVersion: s.version, reason: "duplicate page of another file" })).status).toBe(202);
    expect((await getFileRow(t, s.fileId))?.state).toBe("skipped");
  });
});

describe("links routes (maker-checker over HTTP)", () => {
  async function awaiting() {
    const t = newTenant();
    const s = await seedFile(store, t);
    const a = await call("POST", `${P}/batches/${s.batchId}/files/${s.fileId}/review/approve`, admin(t), { expectedVersion: s.version, link: { target: "hr_employee", targetId: FIN } });
    return { t, s, linkId: a.body.id as string };
  }

  it("the requester gets 409 MAKER_CHECKER_VIOLATION; another admin approves (202); a second approval is NOT_PENDING", async () => {
    const { t, linkId } = await awaiting();
    const self = await call("POST", `${P}/links/${linkId}/approve`, admin(t, USER1));
    expect(self.status).toBe(409);
    expect(self.body.code).toBe("MAKER_CHECKER_VIOLATION");
    expect((await call("POST", `${P}/links/${linkId}/approve`, admin(t, USER2))).status).toBe(202);
    const l = await call("GET", `${P}/links?state=requested`, admin(t));
    expect(l.body.data[0]).toMatchObject({ linkId, state: "requested", approvedBy: USER2 });
    expect((await call("POST", `${P}/links/${linkId}/approve`, admin(t, USER2))).body.code).toBe("NOT_PENDING");
    expect((await call("POST", `${P}/links/${randomUUID()}/approve`, admin(t, USER2))).status).toBe(404);
  });

  it("reject needs a reason; rejecting sends the file back to review; unlink-request needs a linked link and a reason of 5+ chars", async () => {
    const { t, s, linkId } = await awaiting();
    expect((await call("POST", `${P}/links/${linkId}/reject`, admin(t, USER2), {})).status).toBe(400);
    expect((await call("POST", `${P}/links/${linkId}/reject`, admin(t, USER2), { reason: "wrong person" })).status).toBe(202);
    expect((await getFileRow(t, s.fileId))?.state).toBe("needs_review");
    expect((await call("POST", `${P}/links/${linkId}/reject`, admin(t, USER2), { reason: "wrong person" })).status).toBe(409);
    expect((await call("POST", `${P}/links/${linkId}/unlink-request`, admin(t), { reason: "attached wrongly" })).body.code).toBe("NOT_LINKED");
    expect((await call("POST", `${P}/links/${linkId}/unlink-request`, admin(t), { reason: "no" })).status).toBe(400);
  });

  it("unlink-request on a linked link publishes the command (202) and moves it to unlink_requested", async () => {
    const t = newTenant();
    const f = await seedFiled(store, t, { link: "hr_employee" });
    const linkId = (await tenantTx(t, (tx) => tx.select().from(links)))[0]?.id as string;
    expect((await call("POST", `${P}/links/${linkId}/unlink-request`, admin(t), { reason: "attached to the wrong file" })).status).toBe(202);
    expect((await call("GET", `${P}/links?state=unlink_requested`, admin(t))).body.data[0]).toMatchObject({ linkId, documentId: f.documentId, reason: "attached to the wrong file" });
  });

  it("lists links with state filter + pagination, tenant scoped", async () => {
    const t = newTenant(), other = newTenant();
    await seedFiled(store, t, { link: "hr_employee" });
    await seedFiled(store, t, { link: "finance_bill", linkState: "flagged_mismatch" });
    await seedFiled(store, other, { link: "hr_employee" });
    const all = await call("GET", `${P}/links`, admin(t));
    expect(all.body.pagination).toEqual({ total: 2, limit: 50, offset: 0 });
    expect((await call("GET", `${P}/links?state=flagged_mismatch`, admin(t))).body.data).toHaveLength(1);
    expect((await call("GET", `${P}/links?limit=1&offset=1`, admin(t))).body.data).toHaveLength(1);
    expect((await call("GET", `${P}/links?state=bogus`, admin(t))).status).toBe(400);
  });
});

describe("link-lookup (target service over HTTP)", () => {
  it("calls the target's internal lookup with the service secret and tenant, using that service's query names", async () => {
    const t = newTenant();
    const hr = await fakeServer((req, res) => json(res, { data: [{ target: "hr_employee", targetId: FIN, label: "E-1 - A B", amountMinor: null, reference: null, confidence: 1 }] }));
    process.env.HRMS_SERVICE_URL = hr.url;
    try {
      const r = await call("GET", `${P}/link-lookup?target=hr_employee&q=E-1`, admin(t));
      expect(r.status).toBe(200);
      expect(r.body.data).toHaveLength(1);
      expect(r.body.error).toBeUndefined();
      expect(hr.hits[0]?.url).toBe("/internal/v1/scan-link/lookup?employeeNo=E-1&name=E-1");
      expect(hr.hits[0]?.headers).toMatchObject({ "x-internal": "1", "x-tenant-id": t, "x-service-secret": SECRET, "x-internal-caller": "document-service" });
    } finally { await hr.close(); delete process.env.HRMS_SERVICE_URL; }
  });

  it("a target service that is down yields [] + an error marker (200), and the breaker stops hammering it", async () => {
    const t = newTenant();
    process.env.ESTAB_SERVICE_URL = "http://127.0.0.1:1";
    process.env.BULK_SCAN_LOOKUP_TIMEOUT_MS = "500";
    try {
      const r = await call("GET", `${P}/link-lookup?target=eoffice_file&q=F-9`, admin(t));
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ data: [], error: { code: "TARGET_UNAVAILABLE", target: "eoffice_file" } });
    } finally { delete process.env.ESTAB_SERVICE_URL; delete process.env.BULK_SCAN_LOOKUP_TIMEOUT_MS; }
  });

  it("a target that answers 500 or hangs degrades the same way; the breaker opens after repeated failures", async () => {
    const t = newTenant();
    const bad = await fakeServer((req, res) => json(res, { error: "boom" }, 500));
    process.env.FINANCE_SERVICE_URL = bad.url;
    process.env.BULK_SCAN_LOOKUP_BREAKER_FAILURES = "2";
    try {
      for (let i = 0; i < 4; i++) {
        const r = await call("GET", `${P}/link-lookup?target=finance_bill&q=B-1`, admin(t));
        expect(r.body.error).toMatchObject({ code: "TARGET_UNAVAILABLE" });
      }
      expect(bad.hits.length).toBe(2);                                // breaker open: calls 3 and 4 never reached the service
    } finally { await bad.close(); delete process.env.FINANCE_SERVICE_URL; delete process.env.BULK_SCAN_LOOKUP_BREAKER_FAILURES; }
    const hang = await fakeServer(() => { /* never answers */ });
    process.env.HRMS_SERVICE_URL = hang.url;
    process.env.BULK_SCAN_LOOKUP_TIMEOUT_MS = "300";
    try {
      const started = Date.now();
      const r = await call("GET", `${P}/link-lookup?target=hr_employee&q=E-7`, admin(t));
      expect(r.body.error?.code).toBe("TARGET_UNAVAILABLE");
      expect(Date.now() - started).toBeLessThan(3000);
    } finally { await hang.close(); delete process.env.HRMS_SERVICE_URL; delete process.env.BULK_SCAN_LOOKUP_TIMEOUT_MS; }
  });

  it("honours the tenant's allowedLinkTargets (422) and validates the query (400)", async () => {
    const t = newTenant();
    await putSettings(t, { allowedLinkTargets: ["hr_employee"] });
    expect((await call("GET", `${P}/link-lookup?target=finance_bill&q=B`, admin(t))).body.code).toBe("LINK_TARGET_NOT_ALLOWED");
    expect((await call("GET", `${P}/link-lookup?target=nope&q=B`, admin(t))).status).toBe(400);
    expect((await call("GET", `${P}/link-lookup?target=hr_employee`, admin(t))).status).toBe(400);
  });
});

describe("download + page image (audit-on-read, permission matrix)", () => {
  const dl = (id: string, v = "") => `${P}/files/${id}/download${v}`;

  it("document_admin: presigned URL for each variant; exactly ONE audit event with only actor/document/purpose/route", async () => {
    const t = newTenant();
    const d = await seedFiled(store, t);
    for (const [variant, frag] of [["original", "/original?"], ["searchable_pdf", "searchable.pdf"], ["text", "text.masked.txt"], ["json", "structured.json"]] as const) {
      const audits = spyAudit();
      const r = await call("GET", dl(d.documentId, `?variant=${variant}`), admin(t));
      expect(r.status, variant).toBe(200);
      expect(r.body.data.downloadUrl).toContain(frag);
      expect(new Date(r.body.data.expiresAt).getTime()).toBeGreaterThan(Date.now());
      expect(audits).toHaveLength(1);
      expect(audits[0]?.payload).toEqual({
        service: "document", action: "bulk_scan_download", resourceType: "document", resourceId: d.documentId, outcome: "success",
        details: { purpose: "download", route: "GET /v1/documents/bulk-scan/files/:documentId/download" },
      });
      expect(audits[0]?.actorId).toBe(USER1);
      vi.restoreAllMocks();
    }
    expect((await call("GET", dl(d.documentId), admin(t))).body.data.downloadUrl).toContain("/original?");   // default variant
  });

  it("fail closed: a failing audit publish = 500 and NO url", async () => {
    const t = newTenant();
    const d = await seedFiled(store, t);
    spyAudit(true);
    const r = await call("GET", dl(d.documentId), admin(t));
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.body)).not.toContain("s3.test");
  });

  it("permission matrix: document roles, or a role that sees the linked target (only with an ACTIVE link of that kind)", async () => {
    const t = newTenant();
    const estab = await fakeServer((req, res) => json(res, { data: { allowed: true, reason: null } }));   // eOffice clearance: cleared
    process.env.ESTAB_SERVICE_URL = estab.url;
    try { await matrix(t); } finally { await estab.close(); delete process.env.ESTAB_SERVICE_URL; }
  });

  async function matrix(t: string) {
    const hrDoc = await seedFiled(store, t, { link: "hr_employee" });
    const finDoc = await seedFiled(store, t, { link: "finance_voucher" });
    const eoDoc = await seedFiled(store, t, { link: "eoffice_file" });
    const pendingDoc = await seedFiled(store, t, { link: "hr_employee", linkState: "awaiting_approval" });
    const bare = await seedFiled(store, t);
    const who = (role: string) => hdr(USER2, [role], t);
    const status = async (role: string, doc: { documentId: string }) => (await call("GET", dl(doc.documentId), who(role))).status;
    // document roles: always (on an eOffice-linked doc they pass estab's clearance too: the fake server clears everyone here)
    for (const role of ["document_admin", "super_admin"]) for (const d of [hrDoc, finDoc, eoDoc, bare]) expect(await status(role, d), role).toBe(200);
    // generic document_user: never on its own
    for (const d of [hrDoc, finDoc, eoDoc, bare]) expect(await status("document_user", d)).toBe(403);
    // HR
    for (const role of ["hr_admin", "hr_officer"]) { expect(await status(role, hrDoc), role).toBe(200); expect(await status(role, finDoc)).toBe(403); expect(await status(role, bare)).toBe(403); }
    // finance
    for (const role of ["finance_officer", "finance_admin", "audit_officer"]) { expect(await status(role, finDoc), role).toBe(200); expect(await status(role, hrDoc)).toBe(403); }
    // eOffice
    for (const role of ["estab_officer", "estab_admin", "estab_deputy_secretary", "audit_officer"]) {
      expect(await status(role, eoDoc), role).toBe(200);
      expect(await status(role, finDoc), role + " on a finance doc").toBe(role === "audit_officer" ? 200 : 403);   // audit_officer reads finance records too
    }
    // a link that is not (yet) active grants nothing
    expect(await status("hr_officer", pendingDoc)).toBe(403);
    // denied requests are not content reads: no audit event, no url
    const audits = spyAudit();
    expect((await call("GET", dl(hrDoc.documentId), who("finance_officer"))).status).toBe(403);
    expect(audits).toHaveLength(0);
  }

  it("404 for unknown, purged (retention) and cross-tenant documents; 404 for a missing variant; 400 for a bad variant; 401 without auth", async () => {
    const t = newTenant(), other = newTenant();
    const d = await seedFiled(store, t), purged = await seedFiled(store, t, { purged: true });
    expect((await call("GET", dl(randomUUID()), admin(t))).status).toBe(404);
    expect((await call("GET", dl(purged.documentId), admin(t))).status).toBe(404);
    expect((await call("GET", dl(d.documentId), admin(other))).status).toBe(404);
    expect((await app.inject({ method: "GET", url: dl(d.documentId) })).statusCode).toBe(401);
    expect((await call("GET", dl(d.documentId, "?variant=zip"), admin(t))).status).toBe(400);
    const noPdf = await seedFiled(store, t);
    await tenantTx(t, async (tx) => { const { batchFiles } = await import("../src/modules/bulk-scan/schema.js"); const { eq } = await import("drizzle-orm"); await tx.update(batchFiles).set({ searchablePdfKey: null }).where(eq(batchFiles.id, noPdf.fileId)); });
    expect((await call("GET", dl(noPdf.documentId, "?variant=searchable_pdf"), admin(t))).status).toBe(404);
  });

  it("page image: audited as page_view, honours the same permissions, 404 past the last page", async () => {
    const t = newTenant();
    const d = await seedFiled(store, t, { link: "hr_employee" });
    const url = (n: number) => `${P}/files/${d.documentId}/pages/${n}/image`;
    const audits = spyAudit();
    const ok = await call("GET", url(1), admin(t));
    expect(ok.status).toBe(200);
    expect(ok.body.data.url).toContain("derived/pages/1");
    expect(audits).toHaveLength(1);
    expect(audits[0]?.payload).toMatchObject({ action: "bulk_scan_page_view", resourceId: d.documentId, details: { purpose: "page_view", route: "GET /v1/documents/bulk-scan/files/:documentId/pages/:n/image" } });
    expect(Object.keys(audits[0]?.payload.details)).toEqual(["purpose", "route"]);
    expect((await call("GET", url(2), admin(t))).status).toBe(404);
    expect((await call("GET", url(1), hdr(USER2, ["hr_officer"], t))).status).toBe(200);
    expect((await call("GET", url(1), hdr(USER2, ["finance_officer"], t))).status).toBe(403);
    expect((await call("GET", url(0), admin(t))).status).toBe(400);
    spyAudit(true);
    expect((await call("GET", url(1), admin(t))).status).toBe(500);
  });
});

describe("search (filed docs, masked text, tenant scoped)", () => {
  it("finds filed documents by masked text or name; never needs_review files; tenant scoped; filters and paginates; attaches links", async () => {
    const t = newTenant(), other = newTenant();
    const a = await seedFiled(store, t, { searchText: "Sanction order for road repair XXXX XXXX 1234", docType: "sanction_order", name: "order-17.pdf", link: "eoffice_file" });
    await seedFiled(store, t, { searchText: "Pay slip of the month", docType: "pay_slip", name: "slip.pdf" });
    await seedFile(store, t);                                                    // still in review: never searchable
    await seedFiled(store, other, { searchText: "Sanction order for road repair elsewhere" });
    const r = await call("GET", `${P}/search?q=road%20repair`, admin(t));
    expect(r.status).toBe(200);
    expect(r.body.pagination).toEqual({ total: 1, limit: 20, offset: 0 });
    expect(r.body.data[0]).toMatchObject({ documentId: a.documentId, fileName: "order-17.pdf", docType: "sanction_order", links: [{ target: "eoffice_file" }] });
    expect(r.body.data[0].snippetMasked).toContain("road repair");
    expect(r.body.data[0].snippetMasked).toContain("XXXX");
    expect(JSON.stringify(r.body)).not.toMatch(/123412341234/);
    expect((await call("GET", `${P}/search?q=order-17`, admin(t))).body.data).toHaveLength(1);                                 // file name
    expect((await call("GET", `${P}/search?q=pay&docType=pay_slip`, admin(t))).body.data).toHaveLength(1);
    expect((await call("GET", `${P}/search?q=pay&docType=letter`, admin(t))).body.data).toHaveLength(0);
    expect((await call("GET", `${P}/search?q=%25%25`, admin(t))).body.data).toHaveLength(0);                                   // LIKE wildcards are escaped
    expect((await call("GET", `${P}/search?q=o`, admin(t))).status).toBe(400);
    expect((await call("GET", `${P}/search?q=order&limit=1&offset=1`, admin(t))).body.data).toHaveLength(0);
  });

  it("purged (retention) documents disappear from search", async () => {
    const t = newTenant();
    await seedFiled(store, t, { searchText: "needle in a haystack", purged: true });
    expect((await call("GET", `${P}/search?q=needle`, admin(t))).body.data).toHaveLength(0);
  });
});

describe("search audit-on-read", () => {
  it("writes exactly one audit event per search: actor, purpose, route, result count; never the query text or snippets", async () => {
    const t = newTenant();
    await seedFiled(store, t, { searchText: "Sanction order for secretword road repair", name: "order-17.pdf" });
    const audits = spyAudit();
    const r = await call("GET", `${P}/search?q=secretword`, admin(t));
    expect(r.status).toBe(200);
    expect(audits).toHaveLength(1);
    expect(audits[0]?.actorId).toBe(USER1);
    expect(audits[0]?.payload).toMatchObject({ action: "bulk_scan_search", details: { purpose: "search", route: "GET /v1/documents/bulk-scan/search", resultCount: 1 } });
    expect(JSON.stringify(audits[0])).not.toMatch(/secretword|road repair|order-17/);
  });

  it("fails closed when the audit publish fails (no results released)", async () => {
    const t = newTenant();
    await seedFiled(store, t, { searchText: "needle", name: "n.pdf" });
    spyAudit(true);
    const r = await call("GET", `${P}/search?q=needle`, admin(t));
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.body)).not.toContain("needle");
  });
});

describe("GET /providers", () => {
  it("returns the admin-service catalogue state (cached); falls back to tesseract-only when admin-service is down", async () => {
    const t = newTenant();
    const admin_ = await fakeServer((req, res) => json(res, { data: [
      { id: "tesseract", label: "Tesseract", available: true, sandbox: false }, { id: "google_docai", label: "Google Document AI", available: true, sandbox: true }, { id: "bhashini", label: "Bhashini", available: false, sandbox: false },
    ] }));
    process.env.ADMIN_SERVICE_URL = admin_.url;
    try {
      const r = await call("GET", `${P}/providers`, admin(t));
      expect(r.body.data).toEqual([
        { id: "tesseract", label: "Tesseract", available: true, sandbox: false }, { id: "google_docai", label: "Google Document AI", available: true, sandbox: true }, { id: "bhashini", label: "Bhashini", available: false, sandbox: false },
      ]);
      expect(admin_.hits[0]?.headers).toMatchObject({ "x-internal": "1", "x-tenant-id": t, "x-service-secret": SECRET });
      await call("GET", `${P}/providers`, admin(t));
      expect(admin_.hits).toHaveLength(1);                                         // cached
    } finally { await admin_.close(); }
    resetProvidersCache();
    const down = await call("GET", `${P}/providers`, admin(t));
    expect(down.body).toEqual({ data: [{ id: "tesseract", label: "Tesseract (on-device)", available: true, sandbox: false }], degraded: true });
    delete process.env.ADMIN_SERVICE_URL;
  });
});

describe("batch file list/detail never expose raw extracted fields (default flag policy)", () => {
  const RAW = [
    { kind: "pan", value: "ABCDE1234F", raw: "ABCDE1234F", confidence: 0.9, pageNumber: 1, bbox: null },
    { kind: "phone", value: "9876543210", raw: "+91 98765 43210", confidence: 0.9, pageNumber: 1, bbox: null },
    { kind: "email", value: "ravi.kumar@example.com", raw: "ravi.kumar@example.com", confidence: 0.9, pageNumber: 1, bbox: null },
    { kind: "account_no", value: "123456789012", raw: "123456789012", confidence: 0.9, pageNumber: 1, bbox: null },
    { kind: "aadhaar", value: "234123412346", raw: "2341 2341 2346", confidence: 0.9, pageNumber: 1, bbox: null },
  ];
  const LEAKS = ["ABCDE1234F", "9876543210", "98765 43210", "ravi.kumar@example.com", "123456789012", "234123412346", "2341 2341 2346"];

  it("list and detail responses carry no extractedFields and none of the raw values", async () => {
    const t = newTenant();
    const s = await seedFile(store, t, "needs_review", { extractedFields: RAW, searchText: "PAN ABCDE1234F call 9876543210" });
    const list = await app.inject({ method: "GET", url: `${P}/batches/${s.batchId}/files`, headers: admin(t) });
    const detail = await app.inject({ method: "GET", url: `${P}/batches/${s.batchId}/files/${s.fileId}`, headers: admin(t) });
    expect(list.statusCode).toBe(200);
    expect(detail.statusCode).toBe(200);
    for (const body of [list.body, detail.body]) {
      for (const leak of LEAKS) expect(body, leak).not.toContain(leak);
      expect(body).not.toContain("extractedFields");
      expect(body).not.toContain("searchText");
    }
  });
});

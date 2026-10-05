import { describe, it, expect, vi } from "vitest";
import { EOfficeClient, EOfficeError } from "./client.js";

const FILE_ID = "44444444-4444-4444-8444-444444444444";
const DOC_ID = "55555555-5555-4555-8555-555555555555";
const U = "66666666-6666-4666-8666-666666666666";

function mockFetch(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
}
function client(f: ReturnType<typeof mockFetch>) {
  return new EOfficeClient({ baseUrl: "http://estab/", token: "t", fetchImpl: f as unknown as typeof fetch });
}
const calledUrl = (f: ReturnType<typeof mockFetch>): string => String((f.mock.calls[0] as unknown[])[0]);

describe("EOfficeClient.lookupScanTargets", () => {
  it("GETs the internal lookup with encoded params and parses candidates", async () => {
    const f = mockFetch(200, { data: [{ target: "eoffice_file", targetId: FILE_ID, label: "A/1/2026 - Roads", amountMinor: null, reference: "A/1/2026", confidence: 1 }] });
    const out = await client(f).lookupScanTargets({ fileNo: "A/1/2026", subject: "road & works" });
    expect(out).toHaveLength(1);
    expect(out[0]?.confidence).toBe(1);
    const url = calledUrl(f);
    expect(url).toContain("http://estab/internal/v1/scan-link/lookup?");
    expect(url).toContain("fileNo=A%2F1%2F2026");
    expect(url).toContain("subject=road+%26+works");
  });

  it("rejects an empty query before any network call", async () => {
    const f = mockFetch(200, { data: [] });
    await expect(client(f).lookupScanTargets({})).rejects.toThrow();
    expect(f).not.toHaveBeenCalled();
  });

  it("rejects a malformed server response (wrong target kind)", async () => {
    const f = mockFetch(200, { data: [{ target: "hr_employee", targetId: FILE_ID, label: "x", amountMinor: null, reference: null, confidence: 0.5 }] });
    await expect(client(f).lookupScanTargets({ fileNo: "A/1" })).rejects.toThrow();
  });

  it("surfaces HTTP errors as EOfficeError", async () => {
    const f = mockFetch(403, { code: "FORBIDDEN", message: "nope" });
    await expect(client(f).lookupScanTargets({ fileNo: "A/1" })).rejects.toBeInstanceOf(EOfficeError);
  });
});

describe("EOfficeClient.listScannedDocuments", () => {
  const row = {
    id: U, linkId: U, documentId: DOC_ID, batchId: U, fileName: "order.pdf", mimeType: "application/pdf",
    docType: "office_order", pageCount: 2, ocrConfidence: 0.91, piiFlags: ["aadhaar"], textPreviewMasked: "Order XXXX",
    state: "linked", unlinkReason: null, linkedBy: U, approvedBy: null, filedAt: "2026-10-01T00:00:00.000Z",
  };

  it("lists scanned documents for a file", async () => {
    const f = mockFetch(200, { data: [row] });
    const out = await client(f).listScannedDocuments(FILE_ID);
    expect(out[0]?.docType).toBe("office_order");
    expect(calledUrl(f)).toBe(`http://estab/v1/estab/files/${FILE_ID}/scanned-documents`);
  });

  it("passes state and limit", async () => {
    const f = mockFetch(200, { data: [] });
    await client(f).listScannedDocuments(FILE_ID, { state: "all", limit: 5 });
    expect(calledUrl(f)).toContain("?state=all&limit=5");
  });

  it("rejects out-of-range confidence from the server", async () => {
    const f = mockFetch(200, { data: [{ ...row, ocrConfidence: 7 }] });
    await expect(client(f).listScannedDocuments(FILE_ID)).rejects.toThrow();
  });

  it("maps 404 to EOfficeError", async () => {
    const f = mockFetch(404, { code: "NOT_FOUND", message: "file not found" });
    await expect(client(f).listScannedDocuments(FILE_ID)).rejects.toMatchObject({ status: 404 });
  });
});

describe("EOfficeClient.checkClearance", () => {
  const q = { fileId: FILE_ID, userId: U, roles: ["estab_officer", "audit_officer"] };
  it("GETs the clearance endpoint with csv roles and parses the verdict", async () => {
    const f = mockFetch(200, { data: { allowed: false, reason: "CLASSIFIED" } });
    expect(await client(f).checkClearance(q)).toEqual({ allowed: false, reason: "CLASSIFIED" });
    expect(calledUrl(f)).toContain("/internal/v1/scan-link/clearance?");
    expect(calledUrl(f)).toContain("roles=estab_officer%2Caudit_officer");
  });
  it("rejects bad input before the network and malformed responses", async () => {
    const f = mockFetch(200, { data: { allowed: "yes" } });
    await expect(client(f).checkClearance({ ...q, fileId: "nope" })).rejects.toThrow();
    expect(f).not.toHaveBeenCalled();
    await expect(client(f).checkClearance(q)).rejects.toThrow();
  });
  it("surfaces 403 as EOfficeError", async () => {
    await expect(client(mockFetch(403, { code: "FORBIDDEN", message: "no" })).checkClearance(q)).rejects.toBeInstanceOf(EOfficeError);
  });
});

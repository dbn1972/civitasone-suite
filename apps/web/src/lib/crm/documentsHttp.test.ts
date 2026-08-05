import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as dm from "./documents";

function res(body: unknown, init: { status?: number } = {}): Response {
  return new Response(body === undefined ? "" : JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json" },
  });
}

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const docRow = {
  id: "d1",
  subjectType: "contact",
  subjectId: "c1",
  docType: "pan",
  title: "PAN card",
  filename: "pan.pdf",
  version: 1,
  isCurrent: true,
  scanStatus: "clean",
  verificationStatus: "unverified",
  storageProvider: "s3",
  sizeBytes: 1234,
  createdAt: "2026-05-01T09:00:00Z",
};

describe("documents HTTP client (DM-001)", () => {
  it("getDocuments tolerates bare array + wrapper and gates errors", async () => {
    fetchMock.mockResolvedValueOnce(res([docRow]));
    const a = await dm.getDocuments("contact", "c1");
    expect(a.source).toBe("api");
    expect(a.data).toHaveLength(1);
    expect(a.data[0].scanStatus).toBe("clean");

    fetchMock.mockResolvedValueOnce(res({ documents: [docRow] }));
    expect((await dm.getDocuments("contact", "c1")).data).toHaveLength(1);

    fetchMock.mockResolvedValueOnce(res({}, { status: 500 }));
    const e = await dm.getDocuments("contact", "c1");
    expect(e.source).toBe("error");
    expect(e.data).toEqual([]);

    fetchMock.mockRejectedValueOnce(new Error("network"));
    expect((await dm.getDocuments("contact", "c1")).source).toBe("error");
  });

  it("presign returns url + key and rejects an incomplete payload", async () => {
    fetchMock.mockResolvedValueOnce(res({ uploadUrl: "https://s3/put", storageKey: "k/1" }));
    const p = await dm.presignUpload({ subjectType: "contact", subjectId: "c1", filename: "a.pdf", mimeType: "application/pdf" });
    expect(p).toEqual({ uploadUrl: "https://s3/put", storageKey: "k/1" });

    fetchMock.mockResolvedValueOnce(res({ uploadUrl: "https://s3/put" }));
    await expect(
      dm.presignUpload({ subjectType: "contact", subjectId: "c1", filename: "a.pdf", mimeType: "application/pdf" }),
    ).rejects.toThrow(/PRESIGN_INCOMPLETE/);

    fetchMock.mockResolvedValueOnce(res({ code: "E", message: "no" }, { status: 400 }));
    await expect(
      dm.presignUpload({ subjectType: "contact", subjectId: "c1", filename: "a.pdf", mimeType: "application/pdf" }),
    ).rejects.toThrow(/E/);
  });

  it("uploadToStorage PUTs bytes and surfaces storage failures", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 200 }));
    const file = new File(["hi"], "a.pdf", { type: "application/pdf" });
    await expect(dm.uploadToStorage("https://s3/put", file, "application/pdf")).resolves.toBeUndefined();
    const call = fetchMock.mock.calls[0];
    expect(call[0]).toBe("https://s3/put");
    expect(call[1]).toMatchObject({ method: "PUT" });

    fetchMock.mockResolvedValueOnce(new Response("", { status: 403 }));
    await expect(dm.uploadToStorage("https://s3/put", file, "application/pdf")).rejects.toThrow(/STORAGE_UPLOAD_FAILED/);
  });

  it("confirmDocument posts and normalises the returned row (and 202 no-body)", async () => {
    fetchMock.mockResolvedValueOnce(res({ document: docRow }, { status: 201 }));
    const d = await dm.confirmDocument({
      subjectType: "contact", subjectId: "c1", title: "PAN", filename: "pan.pdf",
      storageKey: "k/1", mimeType: "application/pdf", sizeBytes: 10,
    });
    expect(d?.id).toBe("d1");

    fetchMock.mockResolvedValueOnce(res(undefined, { status: 202 }));
    const none = await dm.confirmDocument({
      subjectType: "contact", subjectId: "c1", title: "PAN", filename: "pan.pdf",
      storageKey: "k/1", mimeType: "application/pdf", sizeBytes: 10,
    });
    expect(none).toBeNull();

    fetchMock.mockResolvedValueOnce(res({ code: "E", message: "bad" }, { status: 400 }));
    await expect(
      dm.confirmDocument({ subjectType: "contact", subjectId: "c1", title: "x", filename: "x", storageKey: "k", mimeType: "m", sizeBytes: 1 }),
    ).rejects.toThrow(/E/);
  });

  it("getDownloadUrl returns url, blocks 403 infected, and errors on missing url", async () => {
    fetchMock.mockResolvedValueOnce(res({ url: "https://s3/get" }));
    expect(await dm.getDownloadUrl("d1")).toBe("https://s3/get");

    fetchMock.mockResolvedValueOnce(res({ code: "INFECTED" }, { status: 403 }));
    await expect(dm.getDownloadUrl("d1")).rejects.toThrow(/BLOCKED/);

    fetchMock.mockResolvedValueOnce(res({}));
    await expect(dm.getDownloadUrl("d1")).rejects.toThrow(/DOWNLOAD_URL_MISSING/);
  });

  it("deleteDocument resolves and surfaces errors", async () => {
    fetchMock.mockResolvedValueOnce(res({}, { status: 200 }));
    await expect(dm.deleteDocument("d1")).resolves.toBeUndefined();
    fetchMock.mockResolvedValueOnce(res({ code: "E", message: "no" }, { status: 500 }));
    await expect(dm.deleteDocument("d1")).rejects.toThrow(/E/);
  });
});

describe("document-types + verify (DM-002)", () => {
  const type: dm.DocumentType = {
    id: "t1", code: "pan", name: "PAN card", appliesTo: ["contact", "account"],
    mandatory: true, expiryRequired: false, verificationRequired: true, enabled: true,
  };

  it("getDocumentTypes loaders + CRUD", async () => {
    fetchMock.mockResolvedValueOnce(res([type]));
    const a = await dm.getDocumentTypes();
    expect(a.data).toHaveLength(1);
    expect(a.data[0].appliesTo).toEqual(["contact", "account"]);

    fetchMock.mockResolvedValueOnce(res({}, { status: 500 }));
    expect((await dm.getDocumentTypes()).source).toBe("error");

    fetchMock.mockResolvedValueOnce(res({ id: "t1" }, { status: 201 }));
    await expect(dm.createDocumentType(type)).resolves.toBeUndefined();
    fetchMock.mockResolvedValueOnce(res({}));
    await expect(dm.updateDocumentType("t1", type)).resolves.toBeUndefined();
    fetchMock.mockResolvedValueOnce(res({}, { status: 200 }));
    await expect(dm.deleteDocumentType("t1")).resolves.toBeUndefined();
    fetchMock.mockResolvedValueOnce(res({ code: "E", message: "no" }, { status: 400 }));
    await expect(dm.createDocumentType(type)).rejects.toThrow(/E/);
  });

  it("verifyDocument posts status + reason", async () => {
    fetchMock.mockResolvedValueOnce(res({}, { status: 200 }));
    await expect(dm.verifyDocument("d1", "verified")).resolves.toBeUndefined();
    fetchMock.mockResolvedValueOnce(res({}, { status: 200 }));
    await dm.verifyDocument("d1", "rejected", "blurry scan");
    const body = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(body).toMatchObject({ status: "rejected", reason: "blurry scan" });
    fetchMock.mockResolvedValueOnce(res({ code: "E", message: "no" }, { status: 409 }));
    await expect(dm.verifyDocument("d1", "verified")).rejects.toThrow(/E/);
  });
});

describe("pure helpers", () => {
  const mk = (over: Partial<dm.Document>): dm.Document =>
    dm.normaliseDocument({ ...docRow, ...over }) as dm.Document;

  it("isInfected / isDownloadable", () => {
    expect(dm.isInfected(mk({ scanStatus: "infected" }))).toBe(true);
    expect(dm.isDownloadable(mk({ scanStatus: "infected" }))).toBe(false);
    expect(dm.isDownloadable(mk({ scanStatus: "clean" }))).toBe(true);
    expect(dm.isDownloadable(mk({ scanStatus: "pending" }))).toBe(false); // scan verdict not in yet
    expect(dm.isDownloadable(mk({ scanStatus: "error" }))).toBe(false);
  });

  it("normaliseDocument tolerates alt field spellings + defaults", () => {
    const d = dm.normaliseDocument({
      documentId: "x9", entityType: "account", entityId: "a1", documentType: "gst",
      fileName: "gst.pdf", scan_status: "infected", verified: true, provider: "knowledge_dms",
      contentType: "application/pdf", expiresAt: "2026-12-01", size: "999",
    });
    expect(d).toMatchObject({
      id: "x9", subjectType: "account", subjectId: "a1", docType: "gst",
      filename: "gst.pdf", scanStatus: "infected", verificationStatus: "verified",
      storageProvider: "knowledge_dms", expiryDate: "2026-12-01", sizeBytes: 999,
    });
    expect(dm.normaliseDocument({})).toBeNull();
    expect(dm.normaliseDocument(null)).toBeNull();
  });

  it("buildChains groups supersede history newest-first", () => {
    const v1 = mk({ id: "v1", version: 1, isCurrent: false, createdAt: "2026-01-01T00:00:00Z" });
    const v2 = mk({ id: "v2", version: 2, isCurrent: true, supersedesId: "v1", createdAt: "2026-02-01T00:00:00Z" });
    const other = mk({ id: "o1", version: 1, createdAt: "2026-03-01T00:00:00Z" });
    const chains = dm.buildChains([v1, v2, other]);
    expect(chains).toHaveLength(2);
    const chain = chains.find((c) => c.current.id === "v2")!;
    expect(chain.versions.map((v) => v.id)).toEqual(["v2", "v1"]);
    expect(chain.current.version).toBe(2);
  });

  it("computeAlerts flags missing mandatory + expired + expiring", () => {
    const now = new Date("2026-06-01T00:00:00Z");
    const types: dm.DocumentType[] = [
      { code: "pan", name: "PAN", appliesTo: ["contact"], mandatory: true, expiryRequired: false, verificationRequired: false, enabled: true },
      { code: "gst", name: "GST", appliesTo: ["contact"], mandatory: false, expiryRequired: true, verificationRequired: false, enabled: true },
      { code: "lic", name: "Licence", appliesTo: ["contact"], mandatory: false, expiryRequired: true, verificationRequired: false, enabled: true },
      { code: "off", name: "Off", appliesTo: ["contact"], mandatory: true, expiryRequired: false, verificationRequired: false, enabled: false },
    ];
    const docs = [
      mk({ id: "g", docType: "gst", isCurrent: true, expiryDate: "2026-05-01" }),   // expired
      mk({ id: "l", docType: "lic", isCurrent: true, expiryDate: "2026-06-20" }),   // expiring (<30d)
    ];
    const alerts = dm.computeAlerts("contact", docs, types, now);
    const kinds = alerts.map((a) => `${a.kind}:${a.typeCode}`);
    expect(kinds).toContain("missing:pan");
    expect(kinds).toContain("expired:gst");
    expect(kinds).toContain("expiring:lic");
    expect(kinds).not.toContain("missing:off"); // disabled type ignored
  });
});

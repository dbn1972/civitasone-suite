import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  parseFieldError,
  normaliseCandidates,
  normaliseRules,
  normaliseReport,
  duplicateCheck,
  getDedupRules,
  saveDedupRules,
  mergeEntities,
  getDataQuality,
} from "./dataQuality";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  // browserClient reads getOrCreateDeviceId + sessionStorage
  vi.stubGlobal("sessionStorage", { getItem: () => null, setItem: () => {} });
});
afterEach(() => vi.unstubAllGlobals());

function ok(body: unknown) {
  return { ok: true, status: 200, json: async () => body, clone: () => ({ json: async () => body }) };
}
function fail(status: number, body: unknown) {
  return { ok: false, status, json: async () => body, text: async () => JSON.stringify(body), clone: () => ({ json: async () => body }) };
}

describe("parseFieldError", () => {
  it("maps each known code to its field with the server message", () => {
    expect(parseFieldError("INVALID_MOBILE: bad number")).toEqual({ field: "phone", code: "INVALID_MOBILE", message: "bad number" });
    expect(parseFieldError({ code: "INVALID_GSTIN", message: "bad checksum" })).toEqual({ field: "gstin", code: "INVALID_GSTIN", message: "bad checksum" });
    expect(parseFieldError({ code: "INVALID_PAN" })?.field).toBe("pan");
    expect(parseFieldError({ code: "INVALID_PINCODE" })?.field).toBe("pincode");
  });
  it("supplies a default message when none is given", () => {
    const fe = parseFieldError({ code: "INVALID_PAN" });
    expect(fe?.message).toMatch(/PAN/);
  });
  it("returns null for unknown codes", () => {
    expect(parseFieldError("SOMETHING_ELSE: nope")).toBeNull();
    expect(parseFieldError({ code: undefined })).toBeNull();
  });
});

describe("normaliseCandidates", () => {
  it("accepts bare arrays and { candidates } and sorts by score desc", () => {
    const raw = { candidates: [{ id: "a", score: 0.4 }, { id: "b", score: 0.9, matchedFields: ["email"] }] };
    const out = normaliseCandidates(raw);
    expect(out.map((c) => c.id)).toEqual(["b", "a"]);
    expect(out[0].matchedFields).toEqual(["email"]);
  });
  it("drops entries without an id and handles junk", () => {
    expect(normaliseCandidates([{ score: 1 }, null, "x"])).toEqual([]);
    expect(normaliseCandidates(undefined)).toEqual([]);
  });
});

describe("normaliseRules", () => {
  it("defaults matchType/enabled and coerces numbers", () => {
    const out = normaliseRules([{ field: "email", weight: "2", threshold: "0.5" }]);
    expect(out[0]).toMatchObject({ field: "email", matchType: "exact", weight: 2, threshold: 0.5, enabled: true });
  });
  it("reads { rules } wrapper and respects enabled:false", () => {
    const out = normaliseRules({ rules: [{ field: "pan", matchType: "fuzzy", enabled: false }] });
    expect(out[0].matchType).toBe("fuzzy");
    expect(out[0].enabled).toBe(false);
  });
});

describe("normaliseReport", () => {
  it("fills defaults for a missing/partial payload", () => {
    const r = normaliseReport({ counts: { missing: 3 }, records: [{ id: "1", score: 0.5, issues: ["no email"] }] });
    expect(r.counts).toEqual({ missing: 3, invalid: 0, stale: 0 });
    expect(r.records[0]).toEqual({ id: "1", score: 0.5, issues: ["no email"] });
    expect(r.distribution).toEqual([]);
  });
  it("maps distribution buckets", () => {
    const r = normaliseReport({ distribution: [{ label: "80-100%", count: 5 }] });
    expect(r.distribution[0]).toEqual({ label: "80-100%", count: 5 });
  });
});

describe("client calls", () => {
  it("duplicateCheck posts and normalises", async () => {
    fetchMock.mockResolvedValueOnce(ok([{ id: "x", score: 0.7 }]));
    const out = await duplicateCheck({ email: "a@b.c" });
    expect(out[0].id).toBe("x");
    expect(fetchMock.mock.calls[0][0]).toContain("v1/crm/contacts/duplicate-check");
  });
  it("duplicateCheck throws a coded message on failure", async () => {
    fetchMock.mockResolvedValueOnce(fail(500, { code: "OOPS", message: "boom" }));
    await expect(duplicateCheck({})).rejects.toThrow(/OOPS: boom/);
  });
  it("getDedupRules returns source:error on failure (no fabricated data)", async () => {
    fetchMock.mockResolvedValueOnce(fail(503, {}));
    const res = await getDedupRules();
    expect(res).toEqual({ data: [], source: "error" });
  });
  it("getDedupRules returns source:api on success", async () => {
    fetchMock.mockResolvedValueOnce(ok({ rules: [{ field: "email" }] }));
    const res = await getDedupRules();
    expect(res.source).toBe("api");
    expect(res.data).toHaveLength(1);
  });
  it("getDedupRules returns source:error when fetch throws", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network"));
    expect((await getDedupRules()).source).toBe("error");
  });
  it("saveDedupRules PUTs the rules", async () => {
    fetchMock.mockResolvedValueOnce(ok({}));
    await saveDedupRules([{ field: "email", matchType: "exact", weight: 1, threshold: 0.9, enabled: true }]);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "PUT" });
  });
  it("saveDedupRules throws on failure", async () => {
    fetchMock.mockResolvedValueOnce(fail(400, { code: "BAD", message: "nope" }));
    await expect(saveDedupRules([])).rejects.toThrow(/BAD/);
  });
  it("mergeEntities posts primary+duplicate to the right entity path", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 202, json: async () => ({}), clone: () => ({ json: async () => ({}) }) });
    await mergeEntities("accounts", "p1", "d1");
    expect(fetchMock.mock.calls[0][0]).toContain("v1/crm/accounts/merge");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ primaryId: "p1", duplicateId: "d1" });
  });
  it("mergeEntities throws on failure", async () => {
    fetchMock.mockResolvedValueOnce(fail(409, { code: "CONFLICT", message: "busy" }));
    await expect(mergeEntities("contacts", "a", "b")).rejects.toThrow(/CONFLICT/);
  });
  it("getDataQuality returns source:api on success", async () => {
    fetchMock.mockResolvedValueOnce(ok({ counts: { missing: 1, invalid: 2, stale: 3 }, records: [], distribution: [] }));
    const res = await getDataQuality("contacts", "missing");
    expect(res.source).toBe("api");
    expect(res.data.counts).toEqual({ missing: 1, invalid: 2, stale: 3 });
  });
  it("getDataQuality returns source:error + empty on failure", async () => {
    fetchMock.mockResolvedValueOnce(fail(500, {}));
    const res = await getDataQuality("leads", "invalid");
    expect(res.source).toBe("error");
    expect(res.data.counts).toEqual({ missing: 0, invalid: 0, stale: 0 });
  });
  it("getDataQuality returns source:error when fetch throws", async () => {
    fetchMock.mockRejectedValueOnce(new Error("down"));
    expect((await getDataQuality("accounts", "stale")).source).toBe("error");
  });
});

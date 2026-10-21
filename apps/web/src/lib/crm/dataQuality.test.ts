import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  parseFieldError,
  parseFieldErrors,
  parseMissingMandatoryFields,
  parseDqIssue,
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
  it("reads the { data: [...] } envelope crm-service really answers (it parsed to 'no duplicates' before)", () => {
    // Exactly what POST /v1/crm/contacts/duplicate-check sends: ids, matched field NAMES and a score - no values.
    const raw = { data: [{ id: "c-1", matchedFields: ["phone"], score: 30 }, { id: "c-2", matchedFields: ["email", "phone"], score: 70 }] };
    const out = normaliseCandidates(raw);
    expect(out.map((c) => c.id)).toEqual(["c-2", "c-1"]);
    expect(out[0]).toMatchObject({ matchedFields: ["email", "phone"], score: 70 });
    expect(out[1]!.phone).toBeUndefined();
    expect(out[1]!.email).toBeUndefined();
  });
  it("drops entries without an id and handles junk", () => {
    expect(normaliseCandidates([{ score: 1 }, null, "x"])).toEqual([]);
    expect(normaliseCandidates({ data: "nope" })).toEqual([]);
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
  it("carries a record's display name when present (GAP-CRM-DATA-QUALITY-01)", () => {
    const r = normaliseReport({ records: [{ id: "u-1", score: 0.4, issues: [], name: "Acme Pvt Ltd" }] });
    expect(r.records[0]).toEqual({ id: "u-1", score: 0.4, issues: [], name: "Acme Pvt Ltd" });
  });
  it("omits name (not empty string) when the backend does not send one", () => {
    const r = normaliseReport({ records: [{ id: "u-2", score: 0.4, issues: [] }] });
    expect(r.records[0].name).toBeUndefined();
  });
});

describe("parseFieldErrors (real crm-service 400 body)", () => {
  // Exact shape produced by services/crm-service/src/modules/contacts/routes.ts
  // setErrorHandler for a ZodError: the format code is the zod issue MESSAGE.
  const realBody = {
    code: "VALIDATION_FAILED",
    message: "invalid request",
    correlationId: "c-1",
    retryable: false,
    fieldErrors: [{ field: "phone", message: "INVALID_MOBILE" }],
  };

  it("lands INVALID_MOBILE under phone when it only appears in fieldErrors", () => {
    // The top-level code is VALIDATION_FAILED, so parseFieldError alone sees nothing.
    expect(parseFieldError({ code: realBody.code, message: realBody.message })).toBeNull();
    expect(parseFieldErrors(realBody)).toEqual({ phone: "Enter a valid 10-digit Indian mobile number." });
  });

  it("maps every format code to its field in one pass", () => {
    const out = parseFieldErrors({
      code: "VALIDATION_FAILED",
      fieldErrors: [
        { field: "phone", message: "INVALID_MOBILE" },
        { field: "pincode", message: "INVALID_PINCODE" },
        { field: "gstin", message: "INVALID_GSTIN" },
        { field: "pan", message: "INVALID_PAN" },
      ],
    });
    expect(Object.keys(out).sort()).toEqual(["gstin", "pan", "phone", "pincode"]);
  });

  it("still reads the legacy top-level { code, message } shape", () => {
    expect(parseFieldErrors({ code: "INVALID_PAN", message: "bad pan" })).toEqual({ pan: "bad pan" });
  });

  it("ignores unrelated validation messages and malformed entries", () => {
    expect(parseFieldErrors({ code: "VALIDATION_FAILED", fieldErrors: [{ field: "email", message: "Invalid email" }, null, 7, {}] })).toEqual({});
    expect(parseFieldErrors(null)).toEqual({});
    expect(parseFieldErrors("INVALID_MOBILE")).toEqual({});
  });

  it("does not treat Object.prototype keys as format codes", () => {
    expect(parseFieldError({ code: "toString" })).toBeNull();
    expect(parseFieldErrors({ fieldErrors: [{ field: "x", message: "constructor" }] })).toEqual({});
  });
});

describe("parseMissingMandatoryFields (GAP-CRM-CONTACTS-NEW-01)", () => {
  it("returns the named fields from a 422 MANDATORY_FIELDS_MISSING message", () => {
    expect(
      parseMissingMandatoryFields({ code: "MANDATORY_FIELDS_MISSING", message: "missing mandatory field(s): city, phone" }),
    ).toEqual(["city", "phone"]);
  });

  it("only ever returns known field names, never raw server text", () => {
    expect(
      parseMissingMandatoryFields({
        code: "MANDATORY_FIELDS_MISSING",
        message: "missing mandatory field(s): city, <script>alert(1)</script>, leadSource, city",
      }),
    ).toEqual(["city", "leadSource"]);
  });

  it("returns nothing for another code or a message without field names", () => {
    expect(parseMissingMandatoryFields({ code: "OTHER", message: "missing mandatory field(s): city" })).toEqual([]);
    expect(parseMissingMandatoryFields({ code: "MANDATORY_FIELDS_MISSING", message: "no names here" })).toEqual([]);
    expect(parseMissingMandatoryFields(undefined)).toEqual([]);
  });
});

describe("parseDqIssue", () => {
  it("splits machine-readable issue codes", () => {
    expect(parseDqIssue("missing:email")).toEqual({ kind: "missing", field: "email" });
    expect(parseDqIssue("invalid:gstin")).toEqual({ kind: "invalid", field: "gstin" });
    expect(parseDqIssue("stale")).toEqual({ kind: "stale" });
  });
  it("passes free text through untouched", () => {
    expect(parseDqIssue("no email")).toEqual({ kind: "other", raw: "no email" });
    expect(parseDqIssue("missing:")).toEqual({ kind: "other", raw: "missing:" });
  });
});

describe("normaliseReport against the real crm-service envelope (GAP-CRM-DATA-QUALITY-01/03)", () => {
  // Shape of GET /v1/crm/data-quality?filter=all from data-quality-routes.ts.
  const wire = {
    data: {
      entity: "contacts",
      total: 3,
      distribution: { "0-20": 1, "21-40": 0, "41-60": 0, "61-80": 1, "81-100": 1 },
      counts: { missing: 1, invalid: 1, stale: 0 },
      filter: "all",
      filteredIds: [],
      records: [],
      recordsByFilter: {
        missing: [{ id: "m1", name: "Asha Verma", score: 0.2, issues: ["missing:email"] }],
        invalid: [{ id: "i1", name: null, score: 1, issues: ["invalid:phone"] }],
        stale: [],
      },
    },
  };

  it("unwraps { data }, reads the record-shaped distribution and every filter's rows", () => {
    const r = normaliseReport(wire);
    expect(r.counts).toEqual({ missing: 1, invalid: 1, stale: 0 });
    expect(r.distribution.map((b) => b.count)).toEqual([1, 0, 0, 1, 1]);
    expect(r.distribution[0]).toEqual({ label: "0-20%", count: 1 });
    expect(r.recordsByFilter.missing).toEqual([{ id: "m1", name: "Asha Verma", score: 0.2, issues: ["missing:email"] }]);
    // a null name from the service is omitted, not rendered as "null"
    expect(r.recordsByFilter.invalid[0]).toEqual({ id: "i1", score: 1, issues: ["invalid:phone"] });
    expect(r.recordsByFilter.stale).toEqual([]);
  });

  it("files a single-filter response under that filter's tab", () => {
    const r = normaliseReport({
      data: { filter: "invalid", counts: { invalid: 1 }, records: [{ id: "i1", name: "Ira", score: 0.9, issues: ["invalid:pan"] }] },
    });
    expect(r.recordsByFilter.invalid.map((x) => x.id)).toEqual(["i1"]);
    expect(r.recordsByFilter.missing).toEqual([]);
  });

  it("getDataQuality asks for filter=all by default and normalises the wrapped body", async () => {
    fetchMock.mockResolvedValueOnce(ok(wire));
    const res = await getDataQuality("contacts");
    expect(fetchMock.mock.calls[0][0]).toContain("v1/crm/data-quality?entity=contacts&filter=all");
    expect(res.source).toBe("api");
    expect(res.data.counts.missing).toBe(1);
    expect(res.data.recordsByFilter.missing[0]?.name).toBe("Asha Verma");
  });
});

describe("client calls", () => {
  it("duplicateCheck posts and normalises", async () => {
    fetchMock.mockResolvedValueOnce(ok([{ id: "x", score: 0.7 }]));
    const out = await duplicateCheck({ email: "a@b.c" });
    expect(out[0].id).toBe("x");
    expect(fetchMock.mock.calls[0][0]).toContain("v1/crm/contacts/duplicate-check");
  });
  it("duplicateCheck throws a clerk-safe message on failure, never the server's raw code/message (UX-020)", async () => {
    fetchMock.mockResolvedValue(fail(500, { code: "OOPS", message: "boom" }));
    await expect(duplicateCheck({})).rejects.toThrow(/couldn't save/i);
    await expect(duplicateCheck({})).rejects.not.toThrow(/OOPS|boom/);
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
  it("saveDedupRules throws a clerk-safe message on failure, never the server's raw code/message (UX-020)", async () => {
    fetchMock.mockResolvedValue(fail(400, { code: "BAD", message: "nope" }));
    await expect(saveDedupRules([])).rejects.toThrow("Some details weren't accepted. Check what you entered and try again.");
    await expect(saveDedupRules([])).rejects.not.toThrow(/BAD|nope/);
  });
  it("mergeEntities posts primary+duplicate to the right entity path", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 202, json: async () => ({}), clone: () => ({ json: async () => ({}) }) });
    await mergeEntities("accounts", "p1", "d1");
    expect(fetchMock.mock.calls[0][0]).toContain("v1/crm/accounts/merge");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ primaryId: "p1", duplicateId: "d1" });
  });
  it("mergeEntities throws a clerk-safe message on failure, never the server's raw code/message (UX-020)", async () => {
    fetchMock.mockResolvedValue(fail(409, { code: "CONFLICT", message: "busy" }));
    await expect(mergeEntities("contacts", "a", "b")).rejects.toThrow("This information was changed by someone else. Refresh to see the latest version, then try again.");
    await expect(mergeEntities("contacts", "a", "b")).rejects.not.toThrow(/CONFLICT|busy/);
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

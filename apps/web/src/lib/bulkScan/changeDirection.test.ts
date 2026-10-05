import { describe, it, expect } from "vitest";
import { changeDirections, classifyChange, overallDirection, profileView, requiresApprovalOf, routeOf, type View } from "./changeDirection";

const base: View = {
  reviewThreshold: 0.8, malwareFailClosed: true, filingMakerChecker: true, duplicatePolicy: "skip", dpi: 300, languages: ["eng"],
  providerChain: [{ id: "tesseract", timeoutMs: 1 }, { id: "google_docai", timeoutMs: 1 }],
  classification: { uncertainBelow: 0.5, uncertainMargin: 0.2, minScore: 0.3, docTypes: [{ id: "other" }] },
  bestOf: { enabled: false, threshold: 0.7 }, pii: { policy: { aadhaar: "mask", pan: "flag" }, reviewOnDetect: false },
  allowedLinkTargets: ["hr_employee", "finance_bill"], retentionDaysByType: { other: 30 }, limits: { maxFileBytes: 5 },
};
const dir = (over: View) => changeDirections(base, { ...base, ...over });
const chain = (...ids: string[]) => ({ providerChain: ids.map((id) => ({ id, timeoutMs: 1 })) });

describe("mirror of the server classifier", () => {
  it("thresholds and the two safeguards", () => {
    expect(dir({ reviewThreshold: 0.9 })).toEqual({ reviewThreshold: "tightening" });
    expect(dir({ reviewThreshold: 0.1 })).toEqual({ reviewThreshold: "loosening" });
    expect(dir({ malwareFailClosed: false })).toEqual({ malwareFailClosed: "loosening" });
    expect(changeDirections({ ...base, filingMakerChecker: false }, base)).toEqual({ filingMakerChecker: "tightening" });
  });
  it("provider chain is ordered", () => {
    expect(dir(chain("tesseract"))).toEqual({ providerChain: "tightening" });                       // cloud removed
    expect(dir(chain("tesseract", "google_docai"))).toEqual({});                                    // same order (timeouts only): neutral
    expect(dir(chain("tesseract", "google_docai", "aws_textract"))).toEqual({ providerChain: "loosening" }); // cloud added
    expect(dir(chain("google_docai", "tesseract"))).toEqual({ providerChain: "loosening" });        // cloud primary / reorder
    expect(dir(chain("google_docai"))).toEqual({ providerChain: "loosening" });                     // tesseract removed
    expect(changeDirections({ ...base, ...chain("google_docai", "aws_textract", "tesseract") }, { ...base, ...chain("google_docai", "tesseract") })).toEqual({ providerChain: "tightening" }); // cloud removed, primary unchanged
  });
  it("ANY classification.* change and defaultDocType loosen", () => {
    expect(dir({ classification: { ...(base.classification as object), minScore: 0.9 } })).toEqual({ minScore: "loosening" });
    expect(dir({ classification: { ...(base.classification as object), uncertainMargin: 0.1 } })).toEqual({ uncertainMargin: "loosening" });
    expect(dir({ classification: { ...(base.classification as object), uncertainBelow: 0.9 } })).toEqual({ classification: "loosening" });
    expect(dir({ classification: { ...(base.classification as object), docTypes: [] } })).toEqual({ classification: "loosening" });
    expect(dir({ defaultDocType: "pay_slip" })).toEqual({ defaultDocType: "loosening" });
  });
  it("best-of, PII, duplicate policy, link targets, retention", () => {
    expect(dir({ bestOf: { enabled: true, threshold: 0.7 } })).toEqual({ bestOf: "loosening" });
    expect(changeDirections({ ...base, bestOf: { enabled: true, threshold: 0.7 } }, base)).toEqual({ bestOf: "tightening" });
    expect(dir({ bestOf: { enabled: false, threshold: 0.2 } })).toEqual({});                      // threshold while off: neutral
    expect(changeDirections({ ...base, bestOf: { enabled: true, threshold: 0.7 } }, { ...base, bestOf: { enabled: true, threshold: 0.2 } })).toEqual({ bestOf: "loosening" });
    expect(dir({ pii: { policy: { aadhaar: "redact", pan: "flag" }, reviewOnDetect: false } })).toEqual({ pii: "tightening" });
    expect(dir({ pii: { policy: { aadhaar: "flag", pan: "flag" }, reviewOnDetect: false } })).toEqual({ pii: "loosening" });
    expect(dir({ pii: { policy: { aadhaar: "mask", pan: "weird" }, reviewOnDetect: false } })).toEqual({ pii: "loosening" });
    expect(dir({ pii: { policy: base.pii && (base.pii as { policy: unknown }).policy, reviewOnDetect: true } })).toEqual({ pii: "tightening" });
    expect(dir({ duplicatePolicy: "keep" })).toEqual({ duplicatePolicy: "loosening" });
    expect(dir({ allowedLinkTargets: ["hr_employee"] })).toEqual({ allowedLinkTargets: "tightening" });
    expect(dir({ allowedLinkTargets: ["hr_employee", "finance_bill", "eoffice_file"] })).toEqual({ allowedLinkTargets: "loosening" });
    expect(dir({ allowedLinkTargets: ["finance_bill", "hr_employee"] })).toEqual({});
    expect(dir({ retentionDaysByType: { other: 10 } })).toEqual({ retention: "loosening" });
    expect(dir({ retentionDaysByType: { other: 3000 } })).toEqual({ retention: "loosening" });
    expect(dir({ nonFiledRetentionDays: 5 })).toEqual({ retention: "loosening" });
  });
  it("neutral keys never need approval; unknown keys default-deny", () => {
    expect(dir({ dpi: 600, languages: ["hin"], limits: { maxFileBytes: 9 }, concurrency: 4, twoDigitYearPivot: 10, maxAttempts: 2, preprocessingSteps: [] })).toEqual({});
    expect(dir({ brandNewKey: 1 })).toEqual({ other: "loosening" });
  });
  it("key order does not create a phantom change", () => {
    expect(classifyChange(base, { limits: base.limits, ...base }).fields).toEqual([]);
  });
});

describe("stable key-sorted comparison (same as the server)", () => {
  const reorder = (v: unknown): unknown => (Array.isArray(v) ? v.map(reorder) : v !== null && typeof v === "object"
    ? Object.fromEntries(Object.entries(v as Record<string, unknown>).reverse().map(([k, x]) => [k, reorder(x)])) : v);
  it("a pure key reorder of any nested object is neutral (no direction, no field change)", () => {
    const flipped = reorder(base) as View;
    expect(Object.keys(flipped)).not.toEqual(Object.keys(base));
    expect(classifyChange(base, flipped).fields).toEqual([]);
    expect(changeDirections(base, flipped)).toEqual({});
    expect(routeOf(base, flipped, "settings")).toBe("none");
    // chain entries are objects too: reordering their keys is not a chain change
    expect(changeDirections(base, { ...base, providerChain: [{ timeoutMs: 1, id: "tesseract" }, { timeoutMs: 1, id: "google_docai" }] })).toEqual({});
  });
  it("undefined values are dropped, arrays keep their order", () => {
    expect(classifyChange({ a: 1, dpi: undefined }, { a: 1 }).fields).toEqual([]);
    expect(classifyChange({ languages: ["eng", "hin"] }, { languages: ["hin", "eng"] }).fields).toEqual([{ path: "languages", direction: "neutral" }]);
  });
  it("a provider chain reorder is still judged by the ordered rule, and an unknown key still loosens", () => {
    expect(dir({ providerChain: [{ id: "google_docai", timeoutMs: 1 }, { id: "tesseract", timeoutMs: 1 }] })).toEqual({ providerChain: "loosening" });
    expect(changeDirections(reorder(base) as View, { ...(reorder(base) as View), mystery: { b: 1, a: 2 } })).toEqual({ other: "loosening" });
  });
});

describe("overall direction and routing", () => {
  it("any loosening field needs approval, even next to a tightening one", () => {
    const d = dir({ reviewThreshold: 0.9, malwareFailClosed: false });
    expect(overallDirection(d)).toBe("loosening");
    expect(routeOf(base, { ...base, reviewThreshold: 0.9, malwareFailClosed: false }, "settings")).toBe("approval");
  });
  it("tightening only applies immediately; with a neutral field the tenant change becomes a plain change request; profiles apply directly", () => {
    expect(routeOf(base, { ...base, reviewThreshold: 0.9 }, "settings")).toBe("immediate");
    expect(routeOf(base, { ...base, reviewThreshold: 0.9, dpi: 400 }, "settings")).toBe("request");
    expect(routeOf(base, { ...base, reviewThreshold: 0.9, dpi: 400 }, "profile")).toBe("immediate");
    expect(routeOf(base, { ...base, dpi: 400 }, "settings")).toBe("request");
    expect(routeOf(base, base, "settings")).toBe("none");
  });
});

describe("profile effective view", () => {
  it("an absent override inherits the tenant value; an override is judged against it", () => {
    const eff = (cfg: object) => profileView(base, cfg);
    expect(changeDirections(eff({}), eff({ reviewThreshold: 0.5 }))).toEqual({ reviewThreshold: "loosening" });
    expect(changeDirections(eff({ reviewThreshold: 0.5 }), eff({}))).toEqual({ reviewThreshold: "tightening" });
    expect(changeDirections(eff({}), eff({ classification: { minScore: 0.9 } }))).toEqual({ minScore: "loosening" });
    expect(changeDirections(eff({}), eff({ providerChain: [{ id: "tesseract" }] }))).toEqual({ providerChain: "tightening" });
    expect(changeDirections(eff({}), eff({ defaultDocType: "x", linkDefaults: { target: "hr_employee" } }))).toEqual({ defaultDocType: "loosening" });
  });
});

describe("requiresApprovalOf", () => {
  it("reads the flag at the top level or under data, else null", () => {
    expect(requiresApprovalOf({ id: "cr-1", requiresApproval: true })).toBe(true);
    expect(requiresApprovalOf({ data: { requiresApproval: false } })).toBe(false);
    expect(requiresApprovalOf({ id: "x" })).toBeNull();
    expect(requiresApprovalOf(null)).toBeNull();
    expect(requiresApprovalOf({ requiresApproval: "yes" })).toBeNull();
  });
});

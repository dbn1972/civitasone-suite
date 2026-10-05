import { describe, it, expect } from "vitest";
import {
  bytesToMb, changedKeys, describeIssue, isSensitiveChange, issueAt, mbToBytes, percentToRatio, pivotExamples, profileBodySchema, ratioToPercent, reasonSchema,
  settingsSchema, validateProfile, validateSettings, TWO_DIGIT_YEAR_PIVOT_DEFAULT,
} from "./settingsSchema";
import { settingsObject } from "./fixtures";

const base = (): Record<string, unknown> => settingsObject();
const withPatch = (p: Record<string, unknown>): Record<string, unknown> => ({ ...base(), ...p });

describe("settings schema (mirrors the server)", () => {
  it("accepts the server's own settings document", () => {
    expect(validateSettings(base()).ok).toBe(true);
  });
  it("accepts settings without the optional classifier tuning (server defaults apply)", () => {
    const s = base();
    const cls = { ...(s.classification as Record<string, unknown>) };
    delete cls.uncertainMargin;
    delete cls.minScore;
    expect(validateSettings({ ...s, classification: cls }).ok).toBe(true);
  });
  it("twoDigitYearPivot must be an integer 0..99 and defaults to 49", () => {
    expect(TWO_DIGIT_YEAR_PIVOT_DEFAULT).toBe(49);
    for (const ok of [0, 49, 99]) expect(validateSettings(withPatch({ twoDigitYearPivot: ok })).ok).toBe(true);
    for (const bad of [-1, 100, 49.5, Number.NaN]) {
      const r = validateSettings(withPatch({ twoDigitYearPivot: bad }));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(issueAt(r.issues, "twoDigitYearPivot")).toBeTruthy();
    }
  });
  it("classifier tuning is 0..1", () => {
    const cls = (c: Record<string, unknown>) => withPatch({ classification: { ...(base().classification as object), ...c } });
    expect(validateSettings(cls({ uncertainMargin: 0 })).ok).toBe(true);
    const r = validateSettings(cls({ uncertainMargin: 1.5, minScore: -0.1 }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(issueAt(r.issues, "classification.uncertainMargin")?.key).toBe("err.max");
      expect(issueAt(r.issues, "classification.minScore")?.key).toBe("err.min");
    }
  });
  it("enforces the same ranges as the server", () => {
    expect(validateSettings(withPatch({ dpi: 100 })).ok).toBe(false);
    expect(validateSettings(withPatch({ concurrency: 9 })).ok).toBe(false);
    expect(validateSettings(withPatch({ reviewThreshold: 1.2 })).ok).toBe(false);
    expect(validateSettings(withPatch({ languages: [] })).ok).toBe(false);
    expect(validateSettings(withPatch({ languages: ["eng", "hin", "tam", "tel", "mar"] })).ok).toBe(false);
    expect(validateSettings(withPatch({ providerChain: [] })).ok).toBe(false);
    expect(validateSettings(withPatch({ limits: { maxFileBytes: 10, maxFilesPerBatch: 1, maxBatchBytes: 2048 } })).ok).toBe(false);
  });
  it("cross-field rules: best-of needs two providers, Indic scripts need 200 dpi, unique ids, other required, retention for known types", () => {
    const bestOf = validateSettings(withPatch({ bestOf: { enabled: true, threshold: 0.7 } }));
    expect(!bestOf.ok && issueAt(bestOf.issues, "bestOf.enabled")?.key).toBe("err.bestOfNeedsTwo");
    const dpi = validateSettings(withPatch({ dpi: 150 }));
    expect(!dpi.ok && issueAt(dpi.issues, "dpi")?.key).toBe("err.indicDpi");
    expect(validateSettings(withPatch({ dpi: 150, languages: ["eng"] })).ok).toBe(true);
    const dup = validateSettings(withPatch({ providerChain: [{ id: "tesseract", timeoutMs: 1000 }, { id: "tesseract", timeoutMs: 1000 }] }));
    expect(!dup.ok && issueAt(dup.issues, "providerChain")?.key).toBe("err.dupProvider");
    const noOther = validateSettings(withPatch({ classification: { docTypes: [{ id: "service_book", label: "S", keywords: [], requiredFields: [] }], uncertainBelow: 0.5 } }));
    expect(!noOther.ok && issueAt(noOther.issues, "classification.docTypes")?.key).toBe("err.otherRequired");
    const ret = validateSettings(withPatch({ retentionDaysByType: { ghost: 30 } }));
    expect(!ret.ok && issueAt(ret.issues, "retentionDaysByType.ghost")?.key).toBe("err.retentionUnknownType");
    expect(validateSettings(withPatch({ retentionDaysByType: { service_book: 365 } })).ok).toBe(true);
  });
  it("rejects an unknown key like the server (strict)", () => {
    expect(settingsSchema.safeParse({ ...base(), surprise: 1 }).success).toBe(false);
  });
});

describe("issue descriptions", () => {
  it("never leaks English from zod: always an i18n key with params", () => {
    const r = settingsSchema.safeParse(withPatch({ dpi: 10, languages: [] }));
    if (r.success) throw new Error("expected failure");
    const keys = r.error.issues.map((i) => describeIssue(i));
    expect(keys.find((k) => k.path === "dpi")).toEqual({ path: "dpi", key: "err.min", params: { min: 150 } });
    expect(keys.find((k) => k.path === "languages")?.key).toBe("err.minItems");
  });
});

describe("sensitive change (malware fail-closed OFF)", () => {
  it("only ON -> OFF is sensitive", () => {
    expect(isSensitiveChange({ malwareFailClosed: true }, { malwareFailClosed: false })).toBe(true);
    expect(isSensitiveChange({ malwareFailClosed: false }, { malwareFailClosed: false })).toBe(false);
    expect(isSensitiveChange({ malwareFailClosed: false }, { malwareFailClosed: true })).toBe(false);
  });
  it("the reason must be 3..500 chars", () => {
    expect(reasonSchema.safeParse("ab").success).toBe(false);
    expect(reasonSchema.safeParse("  abc  ").success).toBe(true);
    expect(reasonSchema.safeParse("x".repeat(501)).success).toBe(false);
  });
  it("lists changed top-level keys", () => {
    expect(changedKeys({ a: 1, b: { c: 1 } }, { a: 1, b: { c: 2 }, d: 3 })).toEqual(["b", "d"]);
  });
});

describe("profiles", () => {
  it("validates name and an override-only config", () => {
    expect(validateProfile({ name: "Service book", config: { languages: ["hin", "eng"], dpi: 300 } }).ok).toBe(true);
    expect(validateProfile({ name: "  ", config: {} }).ok).toBe(false);
    const bad = validateProfile({ name: "x", config: { dpi: 100 } });
    expect(!bad.ok && issueAt(bad.issues, "config.dpi")).toBeTruthy();
    const best = validateProfile({ name: "x", config: { bestOf: { enabled: true, threshold: 0.5 }, providerChain: [{ id: "tesseract", timeoutMs: 1000 }] } });
    expect(!best.ok && issueAt(best.issues, "config.bestOf.enabled")?.key).toBe("err.bestOfNeedsTwo");
    expect(profileBodySchema.safeParse({ name: "x", config: { classification: { uncertainMargin: 0.3, minScore: 0.2 } } }).success).toBe(true);
  });
});

describe("unit conversion", () => {
  it("converts MB and percentages without drift", () => {
    expect(mbToBytes(50)).toBe(52428800);
    expect(bytesToMb(52428800)).toBe(50);
    expect(ratioToPercent(0.8)).toBe(80);
    expect(percentToRatio(72.5)).toBe(0.725);
  });
  it("pivot examples show both readings of the boundary", () => {
    expect(pivotExamples(49)).toEqual({ low: "49 → 2049", high: "50 → 1950" });
    expect(pivotExamples(99)).toEqual({ low: "99 → 2099", high: "—" });
    expect(pivotExamples(0)).toEqual({ low: "00 → 2000", high: "01 → 1901" });
  });
});

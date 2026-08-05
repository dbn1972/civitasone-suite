import { describe, it, expect } from "vitest";
import type { CRMLeadCaptureForm } from "@civitasone/types";
import { formHealth, originSummary, publicSubmitPath, rankForms } from "./leadForms";

function form(overrides: Partial<CRMLeadCaptureForm> = {}): CRMLeadCaptureForm {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    tenantId: "22222222-2222-2222-2222-222222222222",
    formKey: "abcd" + "e".repeat(60),
    name: "Landing",
    enabled: true,
    requireConsent: true,
    allowedOrigins: ["https://example.gov.in"],
    defaultLeadSource: "website",
    campaignId: null,
    maxPerMinute: 30,
    version: 1,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("publicSubmitPath", () => {
  it("builds the gateway public lead path and encodes the key", () => {
    expect(publicSubmitPath("abc/def")).toBe("/api/v1/crm/public/leads/abc%2Fdef");
  });
});

describe("formHealth", () => {
  it("flags enabled forms that skip consent as unlawful", () => {
    expect(formHealth(form({ requireConsent: false }))).toBe("unlawful");
    expect(formHealth(form({ enabled: false }))).toBe("paused");
    expect(formHealth(form())).toBe("live");
  });
});

describe("rankForms", () => {
  it("surfaces unlawful forms before live and paused", () => {
    const ranked = rankForms([
      form({ name: "Paused", enabled: false }),
      form({ name: "Live" }),
      form({ name: "Bad", requireConsent: false }),
    ]);
    expect(ranked.map((f) => f.name)).toEqual(["Bad", "Live", "Paused"]);
  });
});

describe("originSummary", () => {
  it("summarises allow-lists for the table", () => {
    expect(originSummary([])).toBe("Any origin");
    expect(originSummary(["https://a.gov.in"])).toBe("https://a.gov.in");
    expect(originSummary(["https://a.gov.in", "https://b.gov.in"])).toBe("https://a.gov.in +1 more");
  });
});

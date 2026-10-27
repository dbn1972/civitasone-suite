import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyIssuanceDesign } from "@/app/_components/ds/designer/issuanceTypes";
import {
  issuanceOutputToUi,
  issuanceUiToOutput,
  mergeOutputsWithIssuance,
  renewalPolicyFromDesign,
  withStoredRenewalPolicy,
  requestSamplePdf,
} from "./issuanceBuilderApi";

describe("issuanceBuilderApi", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("round-trips design through output config including B7 depth fields", () => {
    const design = emptyIssuanceDesign("certificate");
    design.renewalWindowDays = 60;
    design.orientation = "landscape";
    design.qrVerifyEnabled = true;
    design.signatoryDesignationId = "pos-1";
    design.signatoryLabel = "Commissioner";

    const cfg = issuanceUiToOutput(design);
    expect(cfg.kind).toBe("issuance");
    expect(cfg.renewalWindowDays).toBe(60);
    expect(cfg.orientation).toBe("landscape");

    const restored = issuanceOutputToUi([cfg], "certificate");
    expect(restored.renewalWindowDays).toBe(60);
    expect(restored.orientation).toBe("landscape");
    expect(restored.signatoryLabel).toBe("Commissioner");
  });

  it("merges issuance config without duplicating kind", () => {
    const first = issuanceUiToOutput(emptyIssuanceDesign("certificate"));
    const second = issuanceUiToOutput({
      ...emptyIssuanceDesign("certificate"),
      templateBody: "Updated",
    });
    const merged = mergeOutputsWithIssuance([{ kind: "other" }, first], second);
    expect(merged).toHaveLength(2);
    expect((merged[1] as { templateBody: string }).templateBody).toBe("Updated");
  });

  it("returns sandbox preview when issuance pipeline is unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 503 }),
    );
    const result = await requestSamplePdf(emptyIssuanceDesign("certificate"), "Trade Licence");
    expect(result.ok).toBe(true);
    expect(result.mode).toBe("sandbox");
    expect(result.mergedText).toContain("Sample Applicant");
    expect(result.message).toMatch(/sandbox/i);
  });

  it("returns pipeline-mode banner when issuance accepts the sample", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 202 }),
    );
    const result = await requestSamplePdf(emptyIssuanceDesign("grievance"), "Ward grievance");
    expect(result.mode).toBe("pipeline");
    expect(result.mergedText).toMatch(/Closure note|Resolution summary/i);
    expect(result.message).toMatch(/not a live citizen certificate/i);
  });

  it("defaults grievance pattern when outputs are empty", () => {
    const ui = issuanceOutputToUi([], "grievance");
    expect(ui.outputType).toBe("closure_note");
  });
});

// GAP-DESIGNER-DETAIL-B7-01: the Output tab is the single validity editor; the
// runtime renewalPolicy is derived from it so the two stores cannot disagree.
describe("renewalPolicyFromDesign", () => {
  it("derives a duration policy with the renewal window", () => {
    const d = { ...emptyIssuanceDesign("certificate"), validityMode: "duration" as const, validityYears: 3, renewable: true, renewalWindowDays: 45 };
    expect(renewalPolicyFromDesign(d)).toEqual({
      renewable: true,
      renewalWindowDays: 45,
      validityMode: "duration",
      validityYears: 3,
    });
  });

  it("derives a fixed-date policy and drops years", () => {
    const d = { ...emptyIssuanceDesign("certificate"), validityMode: "fixed_date" as const, validityFixedDate: "2030-03-31", renewable: false };
    expect(renewalPolicyFromDesign(d)).toEqual({
      renewable: false,
      renewalWindowDays: 30,
      validityMode: "fixed_date",
      validityFixedDate: "2030-03-31",
    });
  });

  it("never marks a non-expiring document renewable", () => {
    const d = { ...emptyIssuanceDesign("certificate"), validityMode: "none" as const, renewable: true };
    expect(renewalPolicyFromDesign(d)).toMatchObject({ validityMode: "none", renewable: false });
  });

  it("clamps values into what the catalogue API accepts", () => {
    const d = { ...emptyIssuanceDesign("certificate"), validityMode: "duration" as const, validityYears: 500, renewalWindowDays: -4 };
    const out = renewalPolicyFromDesign(d);
    expect(out.validityYears).toBe(99);
    expect(out.renewalWindowDays).toBe(0);
  });
});

describe("withStoredRenewalPolicy", () => {
  it("prefers the stored runtime policy so existing expiry is not changed", () => {
    const base = emptyIssuanceDesign("certificate");
    const out = withStoredRenewalPolicy(base, {
      renewable: true,
      renewalWindowDays: 90,
      validityMode: "duration",
      validityYears: 5,
    });
    expect(out).toMatchObject({ validityMode: "duration", validityYears: 5, renewable: true, renewalWindowDays: 90 });
  });

  it("keeps the design untouched when no policy is stored", () => {
    const base = emptyIssuanceDesign("certificate");
    expect(withStoredRenewalPolicy(base, null)).toBe(base);
  });
});

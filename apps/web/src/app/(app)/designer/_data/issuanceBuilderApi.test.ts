import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyIssuanceDesign } from "@/app/_components/ds/designer/issuanceTypes";
import {
  issuanceOutputToUi,
  issuanceUiToOutput,
  mergeOutputsWithIssuance,
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

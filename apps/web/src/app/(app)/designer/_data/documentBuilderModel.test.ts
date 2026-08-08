import { describe, it, expect } from "vitest";
import type { RequiredDocumentUi } from "@/app/_components/ds/designer/documentTypes";
import type { WorkflowLane } from "./workflowConstants";
import {
  assessDocumentWarnings,
  buildCitizenUploadPreview,
  documentsLocaleCompleteness,
  laneDisplayName,
  suggestFirstVerificationLane,
  summarizeMandatoryLaneWarnings,
  verificationLanesFromWorkflow,
} from "./documentBuilderModel";

function doc(partial: Partial<RequiredDocumentUi> & { id: string }): RequiredDocumentUi {
  return {
    docType: "rent",
    labels: { en: "Rent agreement", hi: "" },
    formats: ["pdf"],
    maxSizeMb: 5,
    mandatory: true,
    verifiedAtLane: "",
    ...partial,
  };
}

function lane(partial: Partial<WorkflowLane> & { key: string; name: string }): WorkflowLane {
  return {
    id: partial.id ?? partial.key,
    optional: false,
    enabled: true,
    designationId: "",
    designationLabel: "",
    slaDays: 5,
    ...partial,
  };
}

describe("documentBuilderModel", () => {
  it("filters verification lanes and formats display names", () => {
    const lanes = [
      lane({ key: "submitted", name: "Submitted" }),
      lane({ key: "inspection", name: "Inspection", designationLabel: "Licensing Inspector" }),
      lane({ key: "decision", name: "Decision", enabled: false }),
      lane({ key: "issued", name: "Issued" }),
    ];
    const verifiable = verificationLanesFromWorkflow(lanes);
    expect(verifiable.map((l) => l.key)).toEqual(["inspection"]);
    expect(laneDisplayName(lanes, "inspection")).toBe("Inspection (Licensing Inspector)");
    expect(suggestFirstVerificationLane(lanes)?.key).toBe("inspection");
  });

  it("warns for mandatory without lane and stale lane (non-blocking)", () => {
    const rows = assessDocumentWarnings(
      [
        doc({ id: "1", verifiedAtLane: "" }),
        doc({ id: "2", verifiedAtLane: "inspection" }),
        doc({ id: "3", verifiedAtLane: "removed_lane" }),
        doc({ id: "4", mandatory: false, verifiedAtLane: "" }),
      ],
      ["inspection"],
    );
    expect(rows[0]?.warning?.kind).toBe("missing_lane");
    expect(rows[1]?.warning).toBeNull();
    expect(rows[2]?.warning?.kind).toBe("stale_lane");
    expect(rows[3]?.warning).toBeNull();

    const summary = summarizeMandatoryLaneWarnings(rows);
    expect(summary.missingLane).toBe(1);
    expect(summary.staleLane).toBe(1);
    expect(summary.banner).toMatch(/warning/i);
    expect(summary.banner).toMatch(/still continue/i);
  });

  it("computes locale completeness meter", () => {
    const meter = documentsLocaleCompleteness([
      doc({ id: "1", labels: { en: "ID proof", hi: "पहचान" } }),
      doc({ id: "2", labels: { en: "Rent", hi: "" } }),
    ]);
    expect(meter.en).toEqual({ filled: 2, total: 2 });
    expect(meter.hi).toEqual({ filled: 1, total: 2 });
    expect(meter.complete).toBe(false);
    expect(meter.meterLabel).toBe("EN 2/2 · HI 1/2");
  });

  it("builds citizen upload preview with camera hint for image formats", () => {
    const preview = buildCitizenUploadPreview(
      doc({
        id: "1",
        labels: { en: "Photo ID", hi: "फोटो पहचान" },
        formats: ["jpg", "png"],
        maxSizeMb: 2,
      }),
      "en",
    );
    expect(preview.label).toBe("Photo ID");
    expect(preview.secondaryLabel).toBe("फोटो पहचान");
    expect(preview.showCameraHint).toBe(true);
    expect(preview.requiredBadge).toBe("Required");
    expect(preview.maxSizeLabel).toBe("Max 2 MB");
    expect(preview.formatsLabel).toContain("JPG");
  });
});

import { describe, expect, it } from "vitest";
import type { ServiceDefinitionDto } from "./designerApi";
import {
  buildVersionDiffRows,
  extractFeeFromMinor,
  feeSummaryForPublish,
  formatPaiseInr,
} from "./versionDiffModel";

const current: ServiceDefinitionDto = {
  id: "def-1",
  serviceKey: "tl",
  name: "Trade License",
  servicePattern: "certificate",
  channels: ["portal", "counter"],
  status: "in_review",
  version: 2,
  hoaCode: "4201",
  feeModel: "flat",
  slaDays: 21,
  workflowDefinitionId: "wf-2",
  requiredDocuments: [{ docType: "id", mandatory: true }],
  forms: [
    {
      formDesign: {
        sections: [],
        fields: { a: {}, b: {}, c: {} },
      },
      runtimeMeta: { feeFromMinor: 75000, feeCurrency: "INR" },
    },
  ],
};

describe("versionDiffModel", () => {
  it("extracts feeFromMinor from runtimeMeta", () => {
    expect(extractFeeFromMinor(current)).toBe(75000);
    expect(formatPaiseInr(75000)).toBe("₹750");
  });

  it("emits human-readable fee and form field summaries", () => {
    const rows = buildVersionDiffRows(current, {
      name: "Trade License",
      hoaCode: "4100",
      feeModel: "flat",
      channels: ["portal"],
      slaDays: 15,
      workflowDefinitionId: "wf-1",
      requiredDocuments: [],
      forms: [
        {
          formDesign: { sections: [], fields: { a: {} } },
          runtimeMeta: { feeFromMinor: 50000 },
        },
      ],
    });

    const fee = rows.find((r) => r.label === "Fee amount");
    expect(fee?.summary).toMatch(/Fee changed ₹500 → ₹750/);

    const fields = rows.find((r) => r.label === "Form fields");
    expect(fields?.summary).toMatch(/Added 2 form field/);

    const wf = rows.find((r) => r.label === "Approval chain");
    expect(wf?.summary).toBe("Approval chain changed");
  });

  it("shows first-version info row when nothing is published", () => {
    const rows = buildVersionDiffRows(current, null);
    expect(rows[0]?.kind).toBe("info");
    expect(rows[0]?.summary).toMatch(/first version/i);
  });

  it("builds publish fee summary", () => {
    expect(feeSummaryForPublish(current)).toMatch(/flat fee/);
    expect(feeSummaryForPublish(current)).toMatch(/₹750/);
    expect(feeSummaryForPublish(current)).toMatch(/HOA 4201/);
  });
});

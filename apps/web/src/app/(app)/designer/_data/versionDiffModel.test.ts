import { describe, expect, it } from "vitest";
import { formatMoney } from "@/lib/formatters";
import type { ServiceDefinitionDto } from "./designerApi";
import {
  buildVersionDiffRows,
  extractFeeFromMinor,
  feeSummaryForPublish,
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
    // GAP-DESIGNER-DETAIL-ENGINES-04: unified with formatMoney — always 2dp.
    expect(formatMoney(75000)).toBe("₹750.00");
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
    expect(fee?.summary).toMatch(/Fee changed ₹500\.00 → ₹750\.00/);

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
    expect(feeSummaryForPublish(current)).toMatch(/₹750\.00/);
    expect(feeSummaryForPublish(current)).toMatch(/HOA 4201/);
  });
});

describe("versionDiffModel office overrides (GAP-DESIGNER-DETAIL-B5-03)", () => {
  const base: ServiceDefinitionDto = {
    ...current,
    officeOverrides: [
      { officeId: "off-1", feeFromMinor: 50000 },
    ],
  };

  it("shows fee change when an office override fee changes", () => {
    const rows = buildVersionDiffRows(base, {
      officeOverrides: [{ officeId: "off-1", feeFromMinor: 75000 }],
    });
    const row = rows.find((r) => r.label === "Office off-1 fee");
    expect(row).toBeDefined();
    expect(row?.after).toMatch(/₹500\.00/);
  });

  it("shows waiver reason in summary when fee becomes zero", () => {
    const withWaiver: ServiceDefinitionDto = {
      ...base,
      officeOverrides: [
        { officeId: "off-1", feeFromMinor: 0, feeWaiverReason: "statutory exemption" },
      ],
    };
    const rows = buildVersionDiffRows(withWaiver, {
      officeOverrides: [{ officeId: "off-1", feeFromMinor: 50000 }],
    });
    const row = rows.find((r) => r.label === "Office off-1 fee");
    expect(row).toBeDefined();
    expect(row?.summary).toContain("statutory exemption");
  });

  it("shows office count change when a new override is added", () => {
    const withTwo: ServiceDefinitionDto = {
      ...base,
      officeOverrides: [
        { officeId: "off-1", feeFromMinor: 50000 },
        { officeId: "off-2", feeFromMinor: 30000 },
      ],
    };
    const rows = buildVersionDiffRows(withTwo, {
      officeOverrides: [{ officeId: "off-1", feeFromMinor: 50000 }],
    });
    const row = rows.find((r) => r.label === "Office variants");
    expect(row).toBeDefined();
    expect(row?.summary).toMatch(/Added 1/);
  });
});

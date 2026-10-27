import { describe, it, expect } from "vitest";
import { collectDesignIssues, countIssuesByBlock } from "./designerGating";

const OK = {
  feeModel: "flat", feeScheduleId: "fs", hoaCode: "0070",
  requiredDocuments: [{ docType: "id", mandatory: true, verifiedAtLane: "scrutiny" }],
  issuanceType: "certificate",
  outputs: [{ kind: "issuance", outputType: "certificate", signatoryDesignationId: "p1", signatoryLabel: "Officer" }],
};

/**
 * Owner decision D4c #7 (GAP-DESIGNER-DETAIL-B5-05): block on anything money- or
 * statute-related (head of account, fee, signatory); warn on the rest.
 */
describe("collectDesignIssues — one hard-versus-soft rule for the wizard (D4c #7)", () => {
  it("reports nothing for a complete design", () => {
    expect(collectDesignIssues(OK, new Set())).toEqual([]);
  });

  it("a fee model without a Head of Account blocks Next on b5", () => {
    expect(collectDesignIssues({ ...OK, hoaCode: "" }, new Set())).toEqual([
      { blockId: "b5", severity: "blocks_next", code: "hoa_missing" },
    ]);
  });

  it("a fee model with no saved fee schedule blocks Next on b5", () => {
    expect(collectDesignIssues({ ...OK, feeScheduleId: null }, new Set())).toEqual([
      { blockId: "b5", severity: "blocks_next", code: "fee_missing" },
    ]);
  });

  it("an issued document with no signatory blocks Next on b7, but a receipt does not need one", () => {
    const none = { ...OK, outputs: [{ kind: "issuance", outputType: "certificate", signatoryDesignationId: "", signatoryLabel: "" }] };
    expect(collectDesignIssues(none, new Set())).toEqual([{ blockId: "b7", severity: "blocks_next", code: "signatory_missing" }]);
    const receipt = { ...OK, issuanceType: "receipt", outputs: [{ kind: "issuance", outputType: "receipt", signatoryDesignationId: "", signatoryLabel: "" }] };
    expect(collectDesignIssues(receipt, new Set())).toEqual([]);
  });

  it("a mandatory document with no verifying lane is only a warning on b6", () => {
    const d = { ...OK, requiredDocuments: [{ docType: "id", mandatory: true }, { docType: "x", mandatory: false }] };
    expect(collectDesignIssues(d, new Set())).toEqual([
      { blockId: "b6", severity: "warning", code: "doc_no_lane", count: 1 },
    ]);
  });

  it("ignores blocks the pattern hides", () => {
    const d = { ...OK, hoaCode: "", requiredDocuments: [{ docType: "id", mandatory: true }] };
    expect(collectDesignIssues(d, new Set(["b5", "b6"]))).toEqual([]);
  });

  it("counts blocking and warning issues per block for the rail", () => {
    const issues = collectDesignIssues({ ...OK, hoaCode: "", requiredDocuments: [{ docType: "id", mandatory: true }] }, new Set());
    expect(countIssuesByBlock(issues)).toEqual({
      b5: { blocking: 1, warning: 0 },
      b6: { blocking: 0, warning: 1 },
    });
  });
});

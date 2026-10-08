import { describe, it, expect } from "vitest";
import { parsePoRef } from "./poRef";
import { mapProcurementGRNSummaries, mapProcurementGRNDetail } from "../../../_data/apiMappers";

// GAP2-PROCUREMENT-GRN-DETAIL-06: the GRN "PO Ref" must never render the opaque
// `procurement_po:<uuid>` composite to a clerk. parsePoRef strips the prefix to
// the bare uuid (for linking) and the mapper carries the server-resolved human
// PO number — fails on the old code, which had neither poId/poNo nor any
// prefix-stripping and printed the raw composite.
describe("parsePoRef (GAP2-PROCUREMENT-GRN-DETAIL-06)", () => {
  it("strips the procurement_po: prefix to the bare uuid", () => {
    expect(parsePoRef("procurement_po:cccccccc-0001-0000-0000-000000000000")).toBe(
      "cccccccc-0001-0000-0000-000000000000",
    );
  });
  it("passes a bare uuid through unchanged", () => {
    expect(parsePoRef("abc-123")).toBe("abc-123");
  });
  it("returns null for missing / placeholder refs so callers fall back to —", () => {
    expect(parsePoRef(null)).toBeNull();
    expect(parsePoRef(undefined)).toBeNull();
    expect(parsePoRef("procurement_po:undefined")).toBeNull();
    expect(parsePoRef("")).toBeNull();
  });
});

describe("GRN mappers carry the resolved PO number (GAP2-PROCUREMENT-GRN-DETAIL-06)", () => {
  const row = {
    id: "grn-1",
    grnNo: "GRN-2026-001",
    poRef: "procurement_po:cccccccc-0001-0000-0000-000000000000",
    poId: "cccccccc-0001-0000-0000-000000000000",
    poNo: "PO-2026-042",
    vendor: "Acme",
    receivedDate: "2026-02-01",
    receivedBy: "u1",
    itemCount: 2,
    status: "accepted",
  };

  it("summary mapper exposes poId and poNo (not just the opaque poRef)", () => {
    const result = mapProcurementGRNSummaries([row]);
    expect(result).toHaveLength(1);
    expect(result![0].poNo).toBe("PO-2026-042");
    expect(result![0].poId).toBe("cccccccc-0001-0000-0000-000000000000");
  });

  it("detail mapper inherits poId and poNo from the summary base", () => {
    const result = mapProcurementGRNDetail({ ...row, items: [], inspection: null });
    expect(result).not.toBeNull();
    expect(result!.poNo).toBe("PO-2026-042");
    expect(result!.poId).toBe("cccccccc-0001-0000-0000-000000000000");
  });
});

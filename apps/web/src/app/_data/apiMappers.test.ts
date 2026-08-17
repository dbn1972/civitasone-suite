import { describe, it, expect } from "vitest";
import { getArrayPayload, parseMinor, parsePaiseFromDisplay, mapProcurementPOListItems, mapProcurementVendorDetails, mapProcurementIndentSummaries, mapCrmAccounts, mapCrmAccountNodes, mapSrnDetail, mapGoodsReturnDetail } from "./apiMappers";

describe("mapCrmAccounts", () => {
  it("maps the accounts payload including hierarchy and contact count", () => {
    const mapped = mapCrmAccounts({
      data: [
        {
          id: "11111111-1111-4000-8000-000000000001",
          name: "Head Office",
          industry: "Government",
          website: "https://example.gov.in",
          parentId: null,
          contactCount: 4,
        },
      ],
    });

    expect(mapped).toEqual([
      {
        id: "11111111-1111-4000-8000-000000000001",
        name: "Head Office",
        industry: "Government",
        website: "https://example.gov.in",
        parentId: null,
        contactCount: 4,
      },
    ]);
  });

  it("normalises absent optional fields to null and a zero count", () => {
    const mapped = mapCrmAccounts([{ id: "a", name: "Branch" }]);

    expect(mapped).toEqual([
      { id: "a", name: "Branch", industry: null, website: null, parentId: null, contactCount: 0 },
    ]);
  });

  it("accepts a contact count that arrives as a bigint string", () => {
    const mapped = mapCrmAccounts([{ id: "a", name: "Branch", contactCount: "12" }]);

    expect(mapped?.[0]?.contactCount).toBe(12);
  });

  it("skips rows without an id or name", () => {
    const mapped = mapCrmAccounts([{ id: "a" }, { name: "No id" }, { id: "b", name: "Good" }]);

    expect(mapped).toHaveLength(1);
    expect(mapped?.[0]?.id).toBe("b");
  });

  it("returns null when the payload is not a list", () => {
    expect(mapCrmAccounts({ nope: true })).toBeNull();
  });
});

describe("mapCrmAccountNodes", () => {
  it("keeps only id and name from hierarchy responses", () => {
    const mapped = mapCrmAccountNodes({ data: [{ id: "a", name: "Parent", industry: "Government" }] });

    expect(mapped).toEqual([{ id: "a", name: "Parent" }]);
  });

  it("returns null when the payload is not a list", () => {
    expect(mapCrmAccountNodes(null)).toBeNull();
  });
});

describe("getArrayPayload", () => {
  it("returns array directly when input is array", () => {
    const input = [{ id: "1" }];
    expect(getArrayPayload(input)).toBe(input);
  });

  it("extracts data field from wrapper object", () => {
    const data = [{ id: "1" }];
    expect(getArrayPayload({ data })).toBe(data);
  });

  it("extracts items field from wrapper object", () => {
    const items = [{ id: "2" }];
    expect(getArrayPayload({ items })).toBe(items);
  });

  it("returns null for non-array, non-object input", () => {
    expect(getArrayPayload(null)).toBeNull();
    expect(getArrayPayload(undefined)).toBeNull();
    expect(getArrayPayload("string")).toBeNull();
    expect(getArrayPayload(42)).toBeNull();
  });

  it("returns null when object has no data or items array", () => {
    expect(getArrayPayload({ name: "test" })).toBeNull();
  });
});

describe("parseMinor", () => {
  it("returns number as-is when finite", () => {
    expect(parseMinor(12500)).toBe(12500);
  });

  it("parses string to number", () => {
    expect(parseMinor("5000")).toBe(5000);
  });

  it("returns 0 for non-finite number", () => {
    expect(parseMinor(NaN)).toBe(0);
    expect(parseMinor(Infinity)).toBe(0);
  });

  it("returns 0 for non-numeric string", () => {
    expect(parseMinor("not-a-number")).toBe(0);
  });

  it("returns 0 for null/undefined/object", () => {
    expect(parseMinor(null)).toBe(0);
    expect(parseMinor(undefined)).toBe(0);
    expect(parseMinor({})).toBe(0);
  });

  it("handles negative numbers", () => {
    expect(parseMinor(-100)).toBe(-100);
    expect(parseMinor("-500")).toBe(-500);
  });
});

describe("parsePaiseFromDisplay", () => {
  it("converts ₹1,234.56 display to paise (123456)", () => {
    expect(parsePaiseFromDisplay("₹1,234.56")).toBe(123456);
  });

  it("converts ₹25.50 to 2550 paise", () => {
    expect(parsePaiseFromDisplay("₹25.50")).toBe(2550);
  });

  it("returns 0 for null input", () => {
    expect(parsePaiseFromDisplay(null)).toBe(0);
  });

  it("returns 0 for empty string", () => {
    expect(parsePaiseFromDisplay("")).toBe(0);
  });

  it("handles number without currency symbol", () => {
    expect(parsePaiseFromDisplay("100")).toBe(10000);
  });

  it("handles display with lakh/crore grouping", () => {
    // ₹12,34,567.89 = 123456789 paise
    expect(parsePaiseFromDisplay("₹12,34,567.89")).toBe(123456789);
  });
});

describe("mapProcurementPOListItems", () => {
  it("maps valid PO list from array payload", () => {
    const input = [
      {
        id: "po-1",
        poNo: "PO-2026-001",
        vendor: "BSNL",
        amount: 500000,
        orderDate: "2026-01-15",
        status: "approved",
      },
    ];
    const result = mapProcurementPOListItems(input);
    expect(result).toHaveLength(1);
    expect(result![0].id).toBe("po-1");
    expect(result![0].poNo).toBe("PO-2026-001");
    expect(result![0].vendor).toBe("BSNL");
    expect(result![0].amount).toBe(500000);
    expect(result![0].status).toBe("approved");
  });

  it("maps from { data: [...] } wrapper", () => {
    const result = mapProcurementPOListItems({
      data: [{ id: "po-2", poNo: "PO-002", vendor: "HAL", amount: 1000, orderDate: "2026-02-01", status: "draft" }],
    });
    expect(result).toHaveLength(1);
    expect(result![0].status).toBe("draft");
  });

  it("returns null for invalid input", () => {
    expect(mapProcurementPOListItems(null)).toBeNull();
    expect(mapProcurementPOListItems("string")).toBeNull();
  });

  it("skips rows without id", () => {
    const result = mapProcurementPOListItems([{ poNo: "PO-X", vendor: "V" }]);
    expect(result).toEqual([]);
  });

  it("normalizes status values", () => {
    const input = [
      { id: "1", poNo: "PO-1", status: "PENDING" },
      { id: "2", poNo: "PO-2", status: "review" },
      { id: "3", poNo: "PO-3", status: "gem_placed" },
    ];
    const result = mapProcurementPOListItems(input)!;
    expect(result[0].status).toBe("pending");
    expect(result[1].status).toBe("draft"); // review → draft
    expect(result[2].status).toBe("gem_placed");
  });

  it("falls back vendorName when vendor field is missing", () => {
    const result = mapProcurementPOListItems([{ id: "1", poNo: "PO-1", vendorName: "Infosys" }]);
    expect(result![0].vendor).toBe("Infosys");
  });
});

describe("mapProcurementVendorDetails", () => {
  it("maps vendor with all fields", () => {
    const input = [
      {
        id: "v-1",
        name: "Tata Consultancy",
        vendorCode: "TCS-001",
        gstin: "27AAACT0000F1ZO",
        category: "IT Services",
        empanelmentStatus: "empanelled",
        rating: 4.5,
      },
    ];
    const result = mapProcurementVendorDetails(input)!;
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Tata Consultancy");
    expect(result[0].vendorCode).toBe("TCS-001");
    expect(result[0].gstin).toBe("27AAACT0000F1ZO");
    expect(result[0].empanelmentStatus).toBe("empanelled");
    expect(result[0].rating).toBe(4.5);
  });

  it("maps empanelment status variants", () => {
    const variants = [
      { id: "1", name: "V1", empanelmentStatus: "blacklisted" },
      { id: "2", name: "V2", empanelmentStatus: "provisional" },
      { id: "3", name: "V3", empanelmentStatus: "registered" },
      { id: "4", name: "V4", empanelmentStatus: "expired" },
    ];
    const result = mapProcurementVendorDetails(variants)!;
    expect(result[0].empanelmentStatus).toBe("blacklisted");
    expect(result[1].empanelmentStatus).toBe("provisional");
    expect(result[2].empanelmentStatus).toBe("empanelled");
    expect(result[3].empanelmentStatus).toBe("not_empanelled");
  });

  it("skips rows without name", () => {
    const result = mapProcurementVendorDetails([{ id: "x" }]);
    expect(result).toEqual([]);
  });

  it("returns null for invalid input", () => {
    expect(mapProcurementVendorDetails(null)).toBeNull();
  });
});

describe("mapProcurementIndentSummaries", () => {
  it("maps indent list correctly", () => {
    const input = [
      {
        id: "ind-1",
        indentNo: "IND-2026-001",
        requestedBy: "Ram Kumar",
        department: "IT",
        itemCount: 5,
        totalMinor: 250000,
        indentDate: "2026-03-15",
        status: "approved",
      },
    ];
    const result = mapProcurementIndentSummaries(input)!;
    expect(result).toHaveLength(1);
    expect(result[0].indentNo).toBe("IND-2026-001");
    expect(result[0].requestedBy).toBe("Ram Kumar");
    expect(result[0].department).toBe("IT");
    expect(result[0].itemCount).toBe(5);
    expect(result[0].estimatedAmount).toBe(250000);
    expect(result[0].status).toBe("approved");
  });

  it("normalizes indent status values", () => {
    const input = [
      { id: "1", indentNo: "I-1", status: "pending" },
      { id: "2", indentNo: "I-2", status: "rejected" },
      { id: "3", indentNo: "I-3", status: "converted_to_po" },
      { id: "4", indentNo: "I-4", status: "unknown" },
    ];
    const result = mapProcurementIndentSummaries(input)!;
    expect(result[0].status).toBe("pending_approval");
    expect(result[1].status).toBe("rejected");
    expect(result[2].status).toBe("converted_to_po");
    expect(result[3].status).toBe("pending_approval"); // unknown defaults
  });

  it("returns null for invalid input", () => {
    expect(mapProcurementIndentSummaries(null)).toBeNull();
  });
});

describe("mapSrnDetail", () => {
  it("maps a signed SRN with all fields present", () => {
    const mapped = mapSrnDetail({
      id: "srn-1",
      grnId: "grn-1",
      storeOfficerId: "user-1",
      receivedAt: "2026-08-16T10:00:00.000Z",
      remarks: "Received in good condition",
      status: "signed",
      createdAt: "2026-08-16T09:00:00.000Z",
    });
    expect(mapped).toEqual({
      id: "srn-1",
      grnId: "grn-1",
      storeOfficerId: "user-1",
      receivedAt: "2026-08-16T10:00:00.000Z",
      remarks: "Received in good condition",
      status: "signed",
      createdAt: "2026-08-16T09:00:00.000Z",
    });
  });

  it("defaults status to draft for any non-'signed' value", () => {
    const mapped = mapSrnDetail({ id: "srn-1", grnId: "grn-1", status: "bogus" });
    expect(mapped?.status).toBe("draft");
  });

  it("returns null when id is missing", () => {
    expect(mapSrnDetail({ grnId: "grn-1", status: "draft" })).toBeNull();
  });

  it("returns null when grnId is missing", () => {
    expect(mapSrnDetail({ id: "srn-1", status: "draft" })).toBeNull();
  });

  it("returns null for a non-object payload", () => {
    expect(mapSrnDetail(null)).toBeNull();
    expect(mapSrnDetail("not an object")).toBeNull();
  });

  it("defaults optional fields when absent", () => {
    const mapped = mapSrnDetail({ id: "srn-1", grnId: "grn-1", status: "draft" });
    expect(mapped).toEqual({
      id: "srn-1",
      grnId: "grn-1",
      storeOfficerId: "—",
      receivedAt: null,
      remarks: undefined,
      status: "draft",
      createdAt: "—",
    });
  });
});

describe("mapGoodsReturnDetail", () => {
  it("maps a fully-inspected goods return", () => {
    const mapped = mapGoodsReturnDetail({
      id: "gr-1",
      originalIssueId: "issue-1",
      itemId: "item-1",
      storeId: "store-1",
      qty: 5,
      reason: "Defective batch",
      qcStatus: "passed",
      qcInspectedBy: "user-1",
      qcInspectedAt: "2026-08-16T10:00:00.000Z",
      qcNotes: "Good condition",
      disposition: "restock",
      createdAt: "2026-08-16T09:00:00.000Z",
    });
    expect(mapped).toEqual({
      id: "gr-1",
      originalIssueId: "issue-1",
      itemId: "item-1",
      storeId: "store-1",
      qty: 5,
      reason: "Defective batch",
      qcStatus: "passed",
      qcInspectedBy: "user-1",
      qcInspectedAt: "2026-08-16T10:00:00.000Z",
      qcNotes: "Good condition",
      disposition: "restock",
      createdAt: "2026-08-16T09:00:00.000Z",
    });
  });

  it("defaults qcStatus to 'pending' and disposition to 'pending' when absent", () => {
    const mapped = mapGoodsReturnDetail({
      id: "gr-2", originalIssueId: "issue-2", itemId: "item-2", storeId: "store-2",
      qty: 1, reason: "Wrong item",
    });
    expect(mapped?.qcStatus).toBe("pending");
    expect(mapped?.disposition).toBe("pending");
    expect(mapped?.qcInspectedBy).toBeNull();
    expect(mapped?.qcNotes).toBeNull();
  });

  it("falls back to 'pending' for an unrecognized qcStatus/disposition value", () => {
    const mapped = mapGoodsReturnDetail({
      id: "gr-3", originalIssueId: "issue-3", itemId: "item-3", storeId: "store-3",
      qty: 2, reason: "x", qcStatus: "bogus", disposition: "bogus",
    });
    expect(mapped?.qcStatus).toBe("pending");
    expect(mapped?.disposition).toBe("pending");
  });

  it("returns null when id is missing", () => {
    expect(mapGoodsReturnDetail({ originalIssueId: "i", itemId: "it", storeId: "s", qty: 1, reason: "x" })).toBeNull();
  });

  it("returns null when originalIssueId, itemId, or storeId is missing", () => {
    expect(mapGoodsReturnDetail({ id: "gr-4", itemId: "it", storeId: "s", qty: 1, reason: "x" })).toBeNull();
    expect(mapGoodsReturnDetail({ id: "gr-4", originalIssueId: "i", storeId: "s", qty: 1, reason: "x" })).toBeNull();
    expect(mapGoodsReturnDetail({ id: "gr-4", originalIssueId: "i", itemId: "it", qty: 1, reason: "x" })).toBeNull();
  });

  it("returns null for a non-object payload", () => {
    expect(mapGoodsReturnDetail(null)).toBeNull();
    expect(mapGoodsReturnDetail("not an object")).toBeNull();
  });
});

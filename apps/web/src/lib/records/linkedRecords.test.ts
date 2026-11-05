import { describe, it, expect, vi, beforeEach } from "vitest";

const po = vi.fn();
vi.mock("@/app/_data/loaders", () => ({
  getProcurementPOById: (id: string) => po(id),
  getProcurementIndentById: async () => ({ data: { indentNo: "IND/2026/0008" }, source: "api" }),
  getProcurementGRNById: async () => ({ data: null, source: "error", status: 500 }),
  getFinanceSanctionById: async () => ({ data: { sanctionNo: "W7-SAN-1" }, source: "api" }),
}));

import { resolveLinkedRecord, linkedRecordId } from "./linkedRecords";

const PO_ID = "5b1c2d3e-0000-4000-8000-000000000000";

describe("linkedRecords (UX-R5: business numbers, not ids)", () => {
  beforeEach(() => { po.mockReset(); po.mockResolvedValue({ data: { poNo: "PO/2026/0025" }, source: "api" }); });

  it("reads the id from a bare uuid or an opaque <type>:<uuid> ref, not from a typed number", () => {
    expect(linkedRecordId(PO_ID)).toBe(PO_ID);
    expect(linkedRecordId(`procurement_po:${PO_ID}`)).toBe(PO_ID);
    expect(linkedRecordId("PO-2026-014")).toBeNull();
    expect(linkedRecordId("procurement_po:undefined")).toBeNull();
  });

  it("resolves an opaque PO ref to its business number and link", async () => {
    expect(await resolveLinkedRecord("po", `procurement_po:${PO_ID}`)).toEqual({ label: "PO/2026/0025", href: `/procurement/orders/${PO_ID}` });
  });

  it("a number the source already sent wins without a lookup", async () => {
    expect(await resolveLinkedRecord("po", `procurement_po:${PO_ID}`, "PO-2026-014")).toEqual({ label: "PO-2026-014", href: `/procurement/orders/${PO_ID}` });
    expect(po).not.toHaveBeenCalled();
  });

  it("a failed lookup is honest and keeps the link, never shows the uuid", async () => {
    const r = await resolveLinkedRecord("grn", `procurement_grn:${PO_ID}`);
    expect(r).toEqual({ label: "GRN (number not available)", href: `/procurement/grn/${PO_ID}` });
  });

  it("a hand-typed reference is shown as typed with no link; empty or broken refs show nothing", async () => {
    expect(await resolveLinkedRecord("po", "procurement_po:abc-123")).toEqual({ label: "abc-123", href: null });
    expect(await resolveLinkedRecord("po", null)).toBeNull();
    expect(await resolveLinkedRecord("po", "procurement_po:undefined")).toBeNull();
  });

  it("indent and sanction refs resolve through their own loaders", async () => {
    expect((await resolveLinkedRecord("indent", PO_ID))?.label).toBe("IND/2026/0008");
    expect((await resolveLinkedRecord("sanction", PO_ID))?.label).toBe("W7-SAN-1");
  });
});

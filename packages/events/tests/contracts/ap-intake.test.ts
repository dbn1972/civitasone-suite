/**
 * UAT bundle 10 (F93/F94/F95; T6-05/06/07): the shared AP-intake contracts,
 * checked against payload shapes sampled from the UAT dead-letter queues
 * (finance-bill-create__finance-service-dlq, procurement-grn-accepted__inventory-service-dlq;
 * personal values replaced).
 */
import { describe, it, expect } from "vitest";
import {
  financeBillCreate, financeBillRejected, procurementGrnAccepted, apIntakeContracts,
} from "../../src/contracts/index.js";

const TENANT = "11111111-0000-0000-0000-000000000001";

/** finance.bill.create as works-service sent it before the fix (DLQ sample). */
const OLD_WORKS_BILL = {
  id: "3fb6e4a9-9bdd-4390-b4c8-56abae32d18b",
  poRef: "works_award:590facb1-f203-4c05-9b53-fb7f4f9e21e2",
  billNo: "W7-BILL-000378",
  grnRef: "works_bill:a2446b76-7567-4bca-9cd9-330504e78b60",
  headId: "dddddddd-0001-0000-0000-000000000001",
  workId: "06292047-d255-477d-9db0-c4c532748d73",
  billDate: "2026-10-30", currency: "INR", netMinor: "30000", tenantId: TENANT,
  vendorId: "works_award:590facb1-f203-4c05-9b53-fb7f4f9e21e2",
  deductions: [], grossMinor: "30000",
  worksBillId: "a2446b76-7567-4bca-9cd9-330504e78b60", contractorName: "Contractor",
};

/** procurement.grn.accepted as procurement sent it (DLQ sample). */
const DLQ_GRN = {
  poNo: "PO/2026/0014",
  grnId: "16eb6e3d-d7f4-4ca8-b436-2af860f2d908",
  items: [{
    itemId: "7c420553-0161-44bc-996f-136384fff067", currency: "INR", itemCode: "W7-ITM-1",
    itemName: "po item", itemType: "consumable", rateMinor: "1000", acceptedQty: 2,
  }],
  poRef: "procurement_po:3d679765-90c2-4eac-9c55-3ec5e861cd4a",
  vendorId: "8c3a147e-3f69-4607-b9b2-21277c50c473",
  grossMinor: "2000", poAmountMinor: "2000", grnAmountMinor: "2000",
};

describe("finance.bill.create contract (F93/F94)", () => {
  it("rejects the old works hand-off: a 'works_award:<id>' vendorId is not a vendor uuid", () => {
    const r = financeBillCreate.validate(OLD_WORKS_BILL);
    expect(r.ok).toBe(false);
    expect(r.violation?.issues.map((i) => i.path)).toEqual(["vendorId"]);
  });

  it("accepts the fixed hand-off: contractor uuid as vendor, head by code, no head id", () => {
    const { headId: _drop, ...rest } = OLD_WORKS_BILL;
    const fixed = { ...rest, vendorId: "d25738c7-f57d-4b05-8e25-5a8ea45e29eb", headCode: "2202" };
    expect(financeBillCreate.validate(fixed)).toEqual({ ok: true });
  });

  it("a money amount sent as a JSON float is a violation; a legacy JSON integer is still read", () => {
    expect(financeBillCreate.validate({ ...OLD_WORKS_BILL, vendorId: TENANT, grossMinor: 12.5 }).ok).toBe(false);
    expect(financeBillCreate.validate({ ...OLD_WORKS_BILL, vendorId: TENANT, grossMinor: 30000 }).ok).toBe(true);
  });

  it("finance.bill.rejected carries a code a producer can show", () => {
    expect(financeBillRejected.validate({ billId: OLD_WORKS_BILL.id, code: "UNKNOWN_VENDOR", reason: "x" }).ok).toBe(true);
    expect(financeBillRejected.validate({ billId: OLD_WORKS_BILL.id, reason: "x" }).ok).toBe(false);
  });
});

describe("procurement.grn.accepted contract (F95)", () => {
  it("the payload procurement actually sends is valid (rateMinor is a wire string)", () => {
    expect(procurementGrnAccepted.validate(DLQ_GRN)).toEqual({ ok: true });
  });

  it("every line must name its itemCode, the key inventory resolves its stock item by", () => {
    const noCode = { ...DLQ_GRN, items: [{ ...DLQ_GRN.items[0], itemCode: undefined }] };
    expect(procurementGrnAccepted.validate(noCode).ok).toBe(false);
  });

  it("storeId, when present, must be a uuid", () => {
    expect(procurementGrnAccepted.validate({ ...DLQ_GRN, storeId: "main-store" }).ok).toBe(false);
    expect(procurementGrnAccepted.validate({ ...DLQ_GRN, storeId: "8703be03-0000-4000-8000-000000000001" }).ok).toBe(true);
  });

  it("each topic's queue name fits the bus truncation limit and has one owner", () => {
    for (const c of apIntakeContracts) {
      expect(c.topic.replace(/\./g, "-").length).toBeLessThanOrEqual(45);
      expect(c.owner).toMatch(/-service$/);
    }
  });
});

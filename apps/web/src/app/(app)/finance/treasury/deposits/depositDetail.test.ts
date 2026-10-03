import { describe, it, expect } from "vitest";
import { mapDepositDetail } from "./depositDetail";

const base = { id: "d1", pdNo: "PD-1", type: "emd", administrator: "Collector", balanceMinor: "5000", status: "active" };

describe("mapDepositDetail (GAP-FINANCE-TREASURY-DEPOSITS-03)", () => {
  it("maps the deposit and its ledger events", () => {
    const d = mapDepositDetail({ data: { ...base, refundedMinor: "100", events: [
      { id: "e1", eventType: "refund", amountMinor: "100", reference: "R-1", journalId: "j1", createdAt: "2026-09-01T00:00:00Z" },
    ] } });
    expect(d).toMatchObject({ id: "d1", pdNo: "PD-1", balanceMinor: "5000", refundedMinor: "100", forfeitedMinor: "0" });
    expect(d?.events).toEqual([{ id: "e1", eventType: "refund", amountMinor: "100", reference: "R-1", journalId: "j1", createdAt: "2026-09-01T00:00:00Z" }]);
  });
  it("treats a missing events array as an empty ledger, not a failure", () => {
    expect(mapDepositDetail({ data: base })?.events).toEqual([]);
  });
  it("returns null for a payload that is not a deposit (so the page shows an error, not a blank deposit)", () => {
    expect(mapDepositDetail(null)).toBeNull();
    expect(mapDepositDetail({ data: { id: "d1" } })).toBeNull();
    expect(mapDepositDetail({ id: "d1", pdNo: "PD-1" })).toBeNull();
  });
});

import { describe, it, expect } from "vitest";
import { field, deriveContractDisplayFields } from "./page.helpers";

// Real GET /v1/contract/contracts/:id response shape, captured live from the
// running contract-service dev stack.
const REAL_CONTRACT = {
  id: "19c91840-1e19-406a-a51e-ecdc92f8edf6",
  tenantId: "11111111-0000-0000-0000-000000000001",
  contractNo: "CON-VERIFY-0001",
  vendorId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
  poRef: null,
  title: "Deep-verify probe contract",
  valueMinor: "123456789",
  currency: "INR",
  startDate: "2026-08-27",
  expiry: "2027-08-27",
  status: "draft",
  slaTerms: null,
  createdAt: "2026-08-27T18:03:13.469Z",
  updatedAt: "2026-08-27T18:03:13.469Z",
  createdBy: "82310d88-a7e7-440d-95b5-b40fd1898232",
  updatedBy: "82310d88-a7e7-440d-95b5-b40fd1898232",
  version: 1,
};

describe("field", () => {
  it("returns the first matching non-empty string key", () => {
    expect(field({ a: "", b: "x" }, "a", "b")).toBe("x");
  });
  it("stringifies a numeric match", () => {
    expect(field({ n: 42 }, "n")).toBe("42");
  });
  it("falls back to the em dash when nothing matches", () => {
    expect(field({ foo: "bar" }, "a", "b")).toBe("—");
  });
});

describe("deriveContractDisplayFields (regression: real contract-service field names)", () => {
  const fields = deriveContractDisplayFields(REAL_CONTRACT);

  it("reads title/contractNo/status directly (these always worked)", () => {
    expect(fields.title).toBe("Deep-verify probe contract");
    expect(fields.contractNo).toBe("CON-VERIFY-0001");
    expect(fields.status).toBe("draft");
    expect(fields.statusLower).toBe("draft");
    expect(fields.statusCls).toBe("mut");
  });

  it("resolves End Date from `expiry`, not endDate/validTo/expiryDate", () => {
    expect(fields.endDate).toBe("2027-08-27");
  });

  it("resolves Party from `vendorId` when no name field exists", () => {
    expect(fields.parties).toBe("3f2504e0-4f89-41d3-9a0c-0305e82c3301");
  });

  it("resolves Value from `valueMinor` (a numeric string) via formatMoney", () => {
    expect(fields.valueDisplay).toBe("₹12,34,567.89");
  });

  it("threads the same value into amountMinor as a string, without precision loss", () => {
    expect(fields.amountMinor).toBe("123456789");
    expect(typeof fields.amountMinor).toBe("string");
  });

  it("still has no source data for contractType/description (contract-service has no such columns)", () => {
    expect(fields.contractType).toBe("—");
    expect(fields.description).toBe("—");
  });

  it("falls back to the hardcoded Procurement department when none is present", () => {
    expect(fields.dept).toBe("Procurement");
  });

  it("leaves amountMinor undefined when there is no usable value at all", () => {
    const { valueMinor: _valueMinor, ...withoutValue } = REAL_CONTRACT;
    const noValue = deriveContractDisplayFields(withoutValue);
    expect(noValue.amountMinor).toBeUndefined();
    expect(noValue.valueDisplay).toBe("—");
  });

  it("accepts a leading '+' the same way formatMoney's Value display does", () => {
    const withPlus = deriveContractDisplayFields({ ...REAL_CONTRACT, valueMinor: "+500000" });
    expect(withPlus.amountMinor).toBe("+500000");
    expect(withPlus.valueDisplay).not.toBe("—");
  });
});

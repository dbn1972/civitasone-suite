/**
 * Segment Phase B3: assertBillHeadValid is keyed on the tenant COA template. Pure (no DB): the masters / HoA / child-head
 * lookups are mocked so the branch logic is what is under test.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NonRetryableError } from "@civitasone/queue";

const m = vi.hoisted(() => ({
  hoa: vi.fn(), ddo: vi.fn(), pao: vi.fn(), kids: vi.fn(),
}));
vi.mock("../src/modules/hoa/domain.js", () => ({ assertValidHoAWithMaster: m.hoa }));
vi.mock("../src/modules/masters/repo.js", () => ({ ddoExists: m.ddo, paoExists: m.pao }));
vi.mock("../src/modules/budget/repo.js", () => ({ hasChildHeadsTx: m.kids }));

import { assertBillHeadValid } from "../src/modules/payments/bill-head.js";
import { HoaError } from "../src/shared/hoa.js";

const T = "11111111-1111-1111-1111-111111111111";
const reader = {} as never;
const base = (over: Record<string, unknown>) => ({
  tenantId: T, ddoCode: null, reader,
  head: { id: "h1", code: "5400", classification: "expense", isControl: false, hoaCode: null },
  ...over,
}) as Parameters<typeof assertBillHeadValid>[0];

beforeEach(() => { vi.resetAllMocks(); m.hoa.mockResolvedValue(undefined); m.ddo.mockResolvedValue(true); m.pao.mockResolvedValue(true); m.kids.mockResolvedValue(false); });

describe("B3 assertBillHeadValid: non-govt templates need no HoA / DDO", () => {
  it.each(["commercial", "nonprofit"] as const)("%s: a leaf expense head with no HoA and no DDO passes, and no govt master is consulted", async (coaTemplate) => {
    await expect(assertBillHeadValid(base({ coaTemplate }))).resolves.toBeUndefined();
    expect(m.hoa).not.toHaveBeenCalled();
    expect(m.ddo).not.toHaveBeenCalled();
    expect(m.pao).not.toHaveBeenCalled();
  });
  it("refuses a group (parent) head, a control account and a non-expense head", async () => {
    m.kids.mockResolvedValueOnce(true);
    await expect(assertBillHeadValid(base({ coaTemplate: "commercial" }))).rejects.toThrow(/group account/);
    await expect(assertBillHeadValid(base({ coaTemplate: "nonprofit", head: { id: "h", code: "5400", classification: "expense", isControl: true, hoaCode: null } }))).rejects.toThrow(/control account/);
    await expect(assertBillHeadValid(base({ coaTemplate: "commercial", head: { id: "h", code: "1100", classification: "asset", isControl: false, hoaCode: null } }))).rejects.toThrow(/expense head/);
  });
});

describe("B3 assertBillHeadValid: govt is unchanged (HoA, then DDO, then PAO)", () => {
  const govt = (over: Record<string, unknown> = {}) => base({ coaTemplate: "govt", ddoCode: "ddo123456", head: { id: "h", code: "2202", classification: "expenditure", isControl: false, hoaCode: "220201101010101010" }, ...over });
  it("calls the HoA master check with the head HoA, then DDO (upper-cased), then PAO when given", async () => {
    const order: string[] = [];
    m.hoa.mockImplementation(async () => { order.push("hoa"); });
    m.ddo.mockImplementation(async () => { order.push("ddo"); return true; });
    m.pao.mockImplementation(async () => { order.push("pao"); return true; });
    await assertBillHeadValid(govt({ paoCode: "pao1" }));
    expect(order).toEqual(["hoa", "ddo", "pao"]);
    expect(m.hoa).toHaveBeenCalledWith("220201101010101010", reader);
    expect(m.ddo).toHaveBeenCalledWith(T, "DDO123456", reader);
    expect(m.kids).not.toHaveBeenCalled();
  });
  it("refuses a bad HoA as NonRetryable and never reaches the DDO check", async () => {
    m.hoa.mockRejectedValue(new HoaError("HOA_UNKNOWN_MAJOR_HEAD", "major head 2202 not found in major-head master"));
    await expect(assertBillHeadValid(govt())).rejects.toBeInstanceOf(NonRetryableError);
    expect(m.ddo).not.toHaveBeenCalled();
  });
  it("refuses an unknown DDO and an unknown PAO", async () => {
    m.ddo.mockResolvedValue(false);
    await expect(assertBillHeadValid(govt())).rejects.toThrow(/UNKNOWN_DDO/);
    m.ddo.mockResolvedValue(true); m.pao.mockResolvedValue(false);
    await expect(assertBillHeadValid(govt({ paoCode: "PAO1" }))).rejects.toThrow(/UNKNOWN_PAO/);
  });
});

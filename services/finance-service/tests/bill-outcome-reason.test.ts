/**
 * findBillOutcome strips the "<CODE>: " prefix the worker puts on a refusal reason with startsWith + slice, never a RegExp
 * built from the stored code, so a code with regex metacharacters can not throw (and cause a 500).
 */
import { describe, it, expect } from "vitest";
import { findBillOutcome } from "../src/modules/payments/repo.js";

const fakeTx = (rows: Array<Array<Record<string, unknown>>>) => {
  const queue = [...rows];
  return { execute: async () => queue.shift() ?? [] };
};
const T = "aaaaaaaa-1111-4000-8000-0000000b0a12";
const ID = "b0a12000-cccc-4000-8000-000000000001";

describe("findBillOutcome reason formatting", () => {
  it("strips the code prefix", async () => {
    const o = await findBillOutcome(fakeTx([[], [{ code: "DUPLICATE_VENDOR_BILL_NO", reason: "DUPLICATE_VENDOR_BILL_NO: vendor bill number X was already lodged" }]]), T, ID);
    expect(o).toEqual({ state: "rejected", code: "DUPLICATE_VENDOR_BILL_NO", reason: "vendor bill number X was already lodged" });
  });
  it("leaves a reason that does not start with the code untouched", async () => {
    const o = await findBillOutcome(fakeTx([[], [{ code: "BILL_REFUSED", reason: "something else" }]]), T, ID);
    expect(o).toMatchObject({ state: "rejected", reason: "something else" });
  });
  it.each(["A(B[", "(", "[a-", "*+?", "\\", "X{2,1}"])("a stored code %j that is an invalid regex pattern does not throw", async (code) => {
    const o = await findBillOutcome(fakeTx([[], [{ code, reason: `${code}: the sentence` }]]), T, ID);
    expect(o).toEqual({ state: "rejected", code, reason: "the sentence" });
  });
  it("no code stored -> BILL_REFUSED with the reason as is", async () => {
    const o = await findBillOutcome(fakeTx([[], [{ code: null, reason: "boom" }]]), T, ID);
    expect(o).toEqual({ state: "rejected", code: "BILL_REFUSED", reason: "boom" });
  });
});

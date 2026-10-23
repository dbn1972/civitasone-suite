import { describe, it, expect } from "vitest";
import { payerBlock } from "./paymentSod";

const MAKER = "11111111-1111-4111-8111-111111111111";
const PASSER = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const bill = { createdBy: MAKER, passedBy: PASSER };

describe("payerBlock (UI hint for the server's payer != creator and payer != passer rules)", () => {
  it("blocks the officer who created the bill", () => {
    expect(payerBlock(bill, MAKER)).toBe("creator");
  });
  it("blocks the officer who passed the bill", () => {
    expect(payerBlock(bill, PASSER)).toBe("passer");
  });
  it("does not block a different officer", () => {
    expect(payerBlock(bill, OTHER)).toBeNull();
  });
  it("names the creator when the same officer both created and passed the bill", () => {
    expect(payerBlock({ createdBy: MAKER, passedBy: MAKER }, MAKER)).toBe("creator");
  });
  it("fails open (the server decides) with an unknown viewer or no actor ids on the bill", () => {
    expect(payerBlock(bill, null)).toBeNull();
    expect(payerBlock(bill, undefined)).toBeNull();
    expect(payerBlock(bill, "")).toBeNull();
    expect(payerBlock({}, MAKER)).toBeNull();
  });
});

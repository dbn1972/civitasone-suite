import { describe, it, expect } from "vitest";
import { stringifyWithBigInt } from "../src/shared/money.js";

describe("stringifyWithBigInt (gateway wire bodies)", () => {
  it("emits a bigint as a bare, exact integer literal", () => {
    expect(stringifyWithBigInt({ amount: 150000n, currency: "INR" })).toBe(
      "{\"amount\":150000,\"currency\":\"INR\"}",
    );
  });

  it("stays exact above Number.MAX_SAFE_INTEGER", () => {
    const body = stringifyWithBigInt({ amount: 9007199254740993n, tenantId: "t1" });
    expect(body).toBe("{\"amount\":9007199254740993,\"tenantId\":\"t1\"}");
  });

  it("leaves non-bigint values and marker look-alike strings alone", () => {
    const lookAlike = "__BIGINT_MINOR__12__";
    const body = stringifyWithBigInt({ note: lookAlike, n: 5, nested: { max: 7n } });
    expect(JSON.parse(body.replace("\"max\":7", "\"max\":\"7\"")).note).toBe(lookAlike);
    expect(body).toContain("\"max\":7");
    expect(body).toContain("\"n\":5");
  });
});

import { describe, it, expect } from "vitest";
import { resolveCitizenPaymentMode } from "./paymentMode";

describe("resolveCitizenPaymentMode", () => {
  it("defaults to gateway", () => {
    expect(resolveCitizenPaymentMode({})).toBe("gateway");
    expect(resolveCitizenPaymentMode({ NODE_ENV: "development" })).toBe("gateway");
    expect(resolveCitizenPaymentMode({ NEXT_PUBLIC_CITIZEN_PAYMENTS_SANDBOX: "false" })).toBe("gateway");
    expect(resolveCitizenPaymentMode({ NEXT_PUBLIC_CITIZEN_PAYMENTS_SANDBOX: "1" })).toBe("gateway");
  });
  it("is sandbox only when explicitly enabled outside production", () => {
    expect(resolveCitizenPaymentMode({ NEXT_PUBLIC_CITIZEN_PAYMENTS_SANDBOX: "true" })).toBe("sandbox");
    expect(resolveCitizenPaymentMode({ NEXT_PUBLIC_CITIZEN_PAYMENTS_SANDBOX: "true", NODE_ENV: "test" })).toBe("sandbox");
  });
  it("is never sandbox in production", () => {
    expect(resolveCitizenPaymentMode({ NEXT_PUBLIC_CITIZEN_PAYMENTS_SANDBOX: "true", NODE_ENV: "production" })).toBe("gateway");
  });
});

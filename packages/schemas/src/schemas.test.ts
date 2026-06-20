import { describe, expect, it } from "vitest";
import { deviceRegisterResponseSchema, paymentSummarySchema, syncPushRequestSchema } from "./index.js";

describe("@civitasone/schemas", () => {
  it("validates device register response", () => {
    const parsed = deviceRegisterResponseSchema.safeParse({
      deviceId: "550e8400-e29b-41d4-a716-446655440000",
      trustToken: "abc123",
      trustLevel: "recognized",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects invalid payment summary", () => {
    const parsed = paymentSummarySchema.safeParse({ referenceId: "x", beneficiary: "y", amountDisplay: "1", status: "bogus" });
    expect(parsed.success).toBe(false);
  });

  it("validates sync push request", () => {
    const parsed = syncPushRequestSchema.safeParse({
      deviceId: "550e8400-e29b-41d4-a716-446655440000",
      mailbox: "approvals",
      cursor: "0",
      mutations: [],
    });
    expect(parsed.success).toBe(true);
  });
});

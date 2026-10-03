/**
 * The retry sweeper republishes without the original `variables`, so a retried candidate sign-in code would render a
 * literal "{{code}}". That template is therefore failed terminally instead of republished; other templates still retry.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { SYSTEM_TEMPLATE_IDS } from "@civitasone/events";

const H = vi.hoisted(() => ({
  findDueRetries: vi.fn(),
  claimDueRetry: vi.fn(async () => true),
  updateDeliveryStatus: vi.fn(async () => undefined),
}));

vi.mock("../src/modules/deliveries/repo.js", () => ({
  findDueRetries: (...a: unknown[]) => H.findDueRetries(...a),
  claimDueRetry: (...a: unknown[]) => H.claimDueRetry(...a),
  updateDeliveryStatus: (...a: unknown[]) => H.updateDeliveryStatus(...a),
}));
vi.mock("@civitasone/db", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  runWithTenant: async (_t: string, fn: () => unknown) => fn(),
}));
vi.mock("../src/shared/db.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  db: { transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb({}) },
}));

import { sweepDueRetries } from "../src/modules/deliveries/sweeper.js";

const row = (templateId: string) => ({
  id: "d1", tenantId: "t1", version: 3, templateId, recipient: "a@example.com", recipientId: null, channel: "email", retryCount: 1, updatedBy: "u1",
});

describe("retry sweeper non-retryable templates", () => {
  const publish = vi.fn(async () => undefined);
  const queue = { publish } as never;
  beforeEach(() => { vi.clearAllMocks(); });

  it("fails the OTP delivery instead of republishing a variable-less retry", async () => {
    H.findDueRetries.mockResolvedValue([row(SYSTEM_TEMPLATE_IDS.candidateLoginOtp)]);
    expect(await sweepDueRetries(queue)).toBe(0);
    expect(publish).not.toHaveBeenCalled();
    expect(H.updateDeliveryStatus).toHaveBeenCalledWith(expect.anything(), "d1", "failed", "u1", 5, undefined, "retry_not_supported");
  });

  it("still republishes retries for other templates", async () => {
    H.findDueRetries.mockResolvedValue([row(SYSTEM_TEMPLATE_IDS.default)]);
    expect(await sweepDueRetries(queue)).toBe(1);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(H.updateDeliveryStatus).not.toHaveBeenCalled();
  });
});

/**
 * Gap 4 — Per-contact frequency cap unit tests.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { checkAndIncrementFrequency, getMaxPerContactPerDay, type FrequencyCapTx } from "../src/modules/frequency-cap/index.js";

const TENANT = "aaaaaaaa-1111-4000-8000-000000freq01";
const CONTACT = "bbbbbbbb-2222-4000-8000-000000freq01";

describe("Gap 4: frequency cap", () => {
  let mockTx: FrequencyCapTx;
  let callCount: number;

  beforeEach(() => {
    callCount = 0;
    mockTx = {
      execute: vi.fn().mockImplementation(async () => {
        callCount++;
        // First call is the upsert, returns current count
        if (callCount === 1) {
          return [{ count: 1 }];
        }
        // If called again, it's the decrement (for cap exceeded)
        return [];
      }),
    };
  });

  it("allows send when under the cap", async () => {
    const result = await checkAndIncrementFrequency(mockTx, TENANT, CONTACT, "sms");
    expect(result).toBe(true);
    expect(mockTx.execute).toHaveBeenCalledTimes(1);
  });

  it("rejects send when over the cap", async () => {
    const max = getMaxPerContactPerDay();
    (mockTx.execute as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      callCount++;
      if (callCount === 1) return [{ count: max + 1 }];
      return [];
    });

    const result = await checkAndIncrementFrequency(mockTx, TENANT, CONTACT, "sms");
    expect(result).toBe(false);
    // Called twice: once for upsert, once for decrement
    expect(mockTx.execute).toHaveBeenCalledTimes(2);
  });

  it("allows exactly at the cap", async () => {
    const max = getMaxPerContactPerDay();
    (mockTx.execute as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      callCount++;
      if (callCount === 1) return [{ count: max }];
      return [];
    });

    const result = await checkAndIncrementFrequency(mockTx, TENANT, CONTACT, "sms");
    expect(result).toBe(true);
    expect(mockTx.execute).toHaveBeenCalledTimes(1);
  });

  it("exports configurable max value", () => {
    expect(getMaxPerContactPerDay()).toBe(3);
  });
});

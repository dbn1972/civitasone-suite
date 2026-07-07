/**
 * Boundary condition tests for Approval Matrix domain logic.
 *
 * Tests single threshold, value = 0, value = max bigint, empty matrix.
 *
 * Validates: Requirements 23.3
 */
import { describe, it, expect } from "vitest";
import {
  resolveApprovalLevel,
  type ApprovalLevel,
} from "../src/modules/approvals/domain.js";

describe("Approval Matrix — Boundary Conditions", () => {
  describe("single threshold", () => {
    it("matches when contract value equals the single threshold", () => {
      const levels: ApprovalLevel[] = [
        { minValuePaise: 100000n, requiredRole: "director" },
      ];
      const result = resolveApprovalLevel(100000n, levels);
      expect(result).not.toBeNull();
      expect(result!.requiredRole).toBe("director");
    });

    it("matches when contract value exceeds the single threshold", () => {
      const levels: ApprovalLevel[] = [
        { minValuePaise: 100000n, requiredRole: "director" },
      ];
      const result = resolveApprovalLevel(999999n, levels);
      expect(result).not.toBeNull();
      expect(result!.requiredRole).toBe("director");
    });

    it("returns null when contract value is below the single threshold", () => {
      const levels: ApprovalLevel[] = [
        { minValuePaise: 100000n, requiredRole: "director" },
      ];
      const result = resolveApprovalLevel(99999n, levels);
      expect(result).toBeNull();
    });
  });

  describe("value = 0", () => {
    it("matches threshold of 0 (any contract requires approval)", () => {
      const levels: ApprovalLevel[] = [
        { minValuePaise: 0n, requiredRole: "department_head" },
      ];
      const result = resolveApprovalLevel(0n, levels);
      expect(result).not.toBeNull();
      expect(result!.requiredRole).toBe("department_head");
    });

    it("returns null when lowest threshold is above 0", () => {
      const levels: ApprovalLevel[] = [
        { minValuePaise: 1n, requiredRole: "department_head" },
      ];
      const result = resolveApprovalLevel(0n, levels);
      expect(result).toBeNull();
    });
  });

  describe("value = max bigint", () => {
    it("selects highest threshold for extremely large contract value", () => {
      const levels: ApprovalLevel[] = [
        { minValuePaise: 100_000n, requiredRole: "department_head" },
        { minValuePaise: 1_000_000n, requiredRole: "director" },
        { minValuePaise: 10_000_000n, requiredRole: "secretary" },
        { minValuePaise: 100_000_000n, requiredRole: "minister" },
      ];
      const maxBigint = 9_007_199_254_740_991n; // near 2^53 - 1
      const result = resolveApprovalLevel(maxBigint, levels);
      expect(result).not.toBeNull();
      expect(result!.requiredRole).toBe("minister");
      expect(result!.minValuePaise).toBe(100_000_000n);
    });

    it("handles threshold at near-MAX_SAFE_INTEGER value", () => {
      const large = 9_007_199_254_740_000n;
      const levels: ApprovalLevel[] = [
        { minValuePaise: large, requiredRole: "minister" },
      ];
      const result = resolveApprovalLevel(large, levels);
      expect(result).not.toBeNull();
      expect(result!.minValuePaise).toBe(large);
    });
  });

  describe("empty matrix", () => {
    it("returns null for empty levels array", () => {
      const result = resolveApprovalLevel(1000000n, []);
      expect(result).toBeNull();
    });
  });

  describe("all-thresholds-equal edge case", () => {
    it("returns any matching level when all thresholds are equal", () => {
      const levels: ApprovalLevel[] = [
        { minValuePaise: 500n, requiredRole: "role_a" },
        { minValuePaise: 500n, requiredRole: "role_b" },
      ];
      const result = resolveApprovalLevel(500n, levels);
      expect(result).not.toBeNull();
      expect(result!.minValuePaise).toBe(500n);
    });
  });

  describe("boundary between two thresholds", () => {
    it("selects lower threshold when value is exactly at the boundary", () => {
      const levels: ApprovalLevel[] = [
        { minValuePaise: 100n, requiredRole: "team_lead" },
        { minValuePaise: 200n, requiredRole: "director" },
      ];
      // Value = 199 — meets 100 but not 200
      const result = resolveApprovalLevel(199n, levels);
      expect(result).not.toBeNull();
      expect(result!.requiredRole).toBe("team_lead");
    });

    it("selects higher threshold when value equals it exactly", () => {
      const levels: ApprovalLevel[] = [
        { minValuePaise: 100n, requiredRole: "team_lead" },
        { minValuePaise: 200n, requiredRole: "director" },
      ];
      const result = resolveApprovalLevel(200n, levels);
      expect(result).not.toBeNull();
      expect(result!.requiredRole).toBe("director");
    });
  });
});

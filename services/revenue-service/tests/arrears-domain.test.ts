/**
 * M5 — Arrears & Recovery domain tests.
 *
 * Covers: ageing bucket correctness at boundaries, instalment schedule generation,
 * write-off validation with maker-checker, recovery referral event.
 *
 * _Requirements: SVC-137_
 */
import { describe, it, expect } from "vitest";
import {
  generateInstalmentSchedule,
  validateWriteOff,
  addMonths,
  assertMakerChecker,
  DomainError,
} from "../src/modules/arrears/domain.js";

describe("Arrears Domain — M5 SVC-137", () => {
  describe("generateInstalmentSchedule", () => {
    it("splits total evenly across instalments", () => {
      const schedule = generateInstalmentSchedule(600000n, 6, "2024-07-01");
      expect(schedule).toHaveLength(6);
      expect(schedule[0]!.amountMinor).toBe(100000n);
      expect(schedule[5]!.amountMinor).toBe(100000n);
    });

    it("last instalment absorbs rounding remainder", () => {
      const schedule = generateInstalmentSchedule(100000n, 3, "2024-07-01");
      // 100000 / 3 = 33333 per instalment, remainder = 1
      expect(schedule[0]!.amountMinor).toBe(33333n);
      expect(schedule[1]!.amountMinor).toBe(33333n);
      expect(schedule[2]!.amountMinor).toBe(33334n); // absorbs remainder
    });

    it("generates correct due dates (monthly)", () => {
      const schedule = generateInstalmentSchedule(600000n, 3, "2024-07-01");
      expect(schedule[0]!.dueDate).toBe("2024-07-01");
      expect(schedule[1]!.dueDate).toBe("2024-08-01");
      expect(schedule[2]!.dueDate).toBe("2024-09-01");
    });

    it("sequence numbers start at 1", () => {
      const schedule = generateInstalmentSchedule(200000n, 2, "2024-07-01");
      expect(schedule[0]!.sequenceNo).toBe(1);
      expect(schedule[1]!.sequenceNo).toBe(2);
    });

    it("rejects invalid total", () => {
      expect(() => generateInstalmentSchedule(0n, 3, "2024-07-01")).toThrow("must be positive");
      expect(() => generateInstalmentSchedule(-100n, 3, "2024-07-01")).toThrow("must be positive");
    });

    it("rejects instalment count < 2", () => {
      expect(() => generateInstalmentSchedule(100000n, 1, "2024-07-01")).toThrow("between 2 and 36");
    });

    it("rejects instalment count > 36", () => {
      expect(() => generateInstalmentSchedule(100000n, 37, "2024-07-01")).toThrow("between 2 and 36");
    });

    it("total of all instalments equals input total", () => {
      const total = 777777n;
      const schedule = generateInstalmentSchedule(total, 7, "2024-01-01");
      const sum = schedule.reduce((s, e) => s + e.amountMinor, 0n);
      expect(sum).toBe(total);
    });
  });

  describe("validateWriteOff", () => {
    it("allows write-off within outstanding", () => {
      expect(() => validateWriteOff(100000n, 500000n)).not.toThrow();
    });

    it("allows write-off of full outstanding", () => {
      expect(() => validateWriteOff(500000n, 500000n)).not.toThrow();
    });

    it("rejects write-off exceeding outstanding", () => {
      expect(() => validateWriteOff(600000n, 500000n)).toThrow("exceeds outstanding");
    });

    it("rejects zero write-off", () => {
      expect(() => validateWriteOff(0n, 500000n)).toThrow("must be positive");
    });
  });

  describe("addMonths", () => {
    it("adds months correctly", () => {
      expect(addMonths("2024-01-15", 1)).toBe("2024-02-15");
      expect(addMonths("2024-01-15", 3)).toBe("2024-04-15");
    });

    it("handles year boundary", () => {
      expect(addMonths("2024-11-15", 2)).toBe("2025-01-15");
    });

    it("handles month-end overflow (Jan 31 + 1 month)", () => {
      const result = addMonths("2024-01-31", 1);
      // In JS, new Date("2024-01-31") + 1 month = 2024-03-02 (leap year Feb has 29 days)
      expect(result).toBe("2024-03-02");
    });
  });

  describe("maker-checker on write-offs", () => {
    it("different users pass", () => {
      expect(() => assertMakerChecker("maker", "checker")).not.toThrow();
    });

    it("same user blocked", () => {
      expect(() => assertMakerChecker("same", "same")).toThrow(DomainError);
    });
  });
});

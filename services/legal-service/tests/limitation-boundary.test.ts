/**
 * Boundary condition tests for Limitation Clock domain logic.
 *
 * Tests period = 1 day, very long periods (3650 days), zero/negative rejection.
 *
 * Validates: Requirements 23.3
 */
import { describe, it, expect } from "vitest";
import {
  computeDeadline,
  scheduleNotifications,
  isExpired,
  LimitationDomainError,
} from "../src/modules/limitations/domain.js";

describe("Limitation Clock — Boundary Conditions", () => {
  describe("period = 1 day (minimum valid)", () => {
    it("computes deadline 1 day after filing", () => {
      const filingDate = new Date(Date.UTC(2024, 0, 15)); // Jan 15
      const deadline = computeDeadline(filingDate, 1);
      const expected = new Date(Date.UTC(2024, 0, 16)); // Jan 16
      expect(deadline.getTime()).toBe(expected.getTime());
    });

    it("has no schedulable notifications for 1-day period", () => {
      const filingDate = new Date(Date.UTC(2024, 0, 15));
      const deadline = computeDeadline(filingDate, 1);
      // All alert offsets (30, 15, 7) are larger than the period, so all fall before filing
      const alerts = scheduleNotifications(deadline, filingDate);
      expect(alerts.at30d).toBeUndefined();
      expect(alerts.at15d).toBeUndefined();
      expect(alerts.at7d).toBeUndefined();
    });
  });

  describe("very long period (3650 days = ~10 years)", () => {
    it("computes deadline exactly 3650 days later", () => {
      const filingDate = new Date(Date.UTC(2024, 0, 1));
      const deadline = computeDeadline(filingDate, 3650);
      const expected = new Date(filingDate.getTime());
      expected.setUTCDate(expected.getUTCDate() + 3650);
      expect(deadline.getTime()).toBe(expected.getTime());
    });

    it("all three notifications are scheduled for long period", () => {
      const filingDate = new Date(Date.UTC(2024, 0, 1));
      const deadline = computeDeadline(filingDate, 3650);
      const alerts = scheduleNotifications(deadline, filingDate);
      expect(alerts.at30d).toBeDefined();
      expect(alerts.at15d).toBeDefined();
      expect(alerts.at7d).toBeDefined();
    });

    it("alert chronological order is maintained for long period", () => {
      const filingDate = new Date(Date.UTC(2024, 0, 1));
      const deadline = computeDeadline(filingDate, 3650);
      const alerts = scheduleNotifications(deadline, filingDate);
      expect(alerts.at30d!.getTime()).toBeLessThan(alerts.at15d!.getTime());
      expect(alerts.at15d!.getTime()).toBeLessThan(alerts.at7d!.getTime());
      expect(alerts.at7d!.getTime()).toBeLessThan(deadline.getTime());
    });
  });

  describe("period exactly matching notification offsets", () => {
    it("period = 7 days: only 7d notification is schedulable", () => {
      const filingDate = new Date(Date.UTC(2024, 6, 1));
      const deadline = computeDeadline(filingDate, 7);
      const alerts = scheduleNotifications(deadline, filingDate);
      // 30d and 15d alerts fall before filing date; 7d alert is at filing date (not > currentDate)
      expect(alerts.at30d).toBeUndefined();
      expect(alerts.at15d).toBeUndefined();
      // 7 days before deadline = filingDate, which is NOT > currentDate (it's equal)
      expect(alerts.at7d).toBeUndefined();
    });

    it("period = 8 days: 7d notification is 1 day after filing", () => {
      const filingDate = new Date(Date.UTC(2024, 6, 1));
      const deadline = computeDeadline(filingDate, 8);
      const alerts = scheduleNotifications(deadline, filingDate);
      expect(alerts.at30d).toBeUndefined();
      expect(alerts.at15d).toBeUndefined();
      // deadline - 7 days = filingDate + 1 day → > currentDate
      expect(alerts.at7d).toBeDefined();
    });

    it("period = 31 days: all notifications are schedulable", () => {
      const filingDate = new Date(Date.UTC(2024, 6, 1));
      const deadline = computeDeadline(filingDate, 31);
      const alerts = scheduleNotifications(deadline, filingDate);
      expect(alerts.at30d).toBeDefined();
      expect(alerts.at15d).toBeDefined();
      expect(alerts.at7d).toBeDefined();
    });
  });

  describe("invalid period rejection", () => {
    it("rejects period = 0", () => {
      const filingDate = new Date(Date.UTC(2024, 0, 1));
      expect(() => computeDeadline(filingDate, 0)).toThrow(LimitationDomainError);
    });

    it("rejects negative period", () => {
      const filingDate = new Date(Date.UTC(2024, 0, 1));
      expect(() => computeDeadline(filingDate, -100)).toThrow(LimitationDomainError);
    });
  });

  describe("isExpired boundary", () => {
    it("returns false when current is 1ms before deadline", () => {
      const deadline = new Date(Date.UTC(2024, 6, 1));
      const current = new Date(deadline.getTime() - 1);
      expect(isExpired(deadline, current)).toBe(false);
    });

    it("returns true when current equals deadline exactly", () => {
      const deadline = new Date(Date.UTC(2024, 6, 1));
      expect(isExpired(deadline, deadline)).toBe(true);
    });

    it("returns true when current is 1ms after deadline", () => {
      const deadline = new Date(Date.UTC(2024, 6, 1));
      const current = new Date(deadline.getTime() + 1);
      expect(isExpired(deadline, current)).toBe(true);
    });
  });
});

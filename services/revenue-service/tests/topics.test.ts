/**
 * Shared infrastructure tests — topics.ts
 *
 * Covers: COMMANDS, EVENTS, CONSUMED_EVENTS naming convention, SERVICE constant
 *
 * _Requirements: Req 20 (Shared Infrastructure Test Coverage)_
 */
import { describe, it, expect } from "vitest";
import { COMMANDS, EVENTS, CONSUMED_EVENTS, SERVICE } from "../src/topics.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

const TOPIC_PATTERN = /^(revenue|finance)\.\w+\.\w+$/;

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("topics.ts — Shared Infrastructure", () => {
  describe("SERVICE constant", () => {
    it("is 'revenue'", () => {
      expect(SERVICE).toBe("revenue");
    });
  });

  describe("COMMANDS", () => {
    const entries = Object.entries(COMMANDS);

    it("has at least one command defined", () => {
      expect(entries.length).toBeGreaterThan(0);
    });

    it("all values are non-empty strings", () => {
      for (const [key, value] of entries) {
        expect(value, `COMMANDS.${key} should be a non-empty string`).toBeTruthy();
        expect(typeof value, `COMMANDS.${key} should be a string`).toBe("string");
        expect(value.length, `COMMANDS.${key} should not be empty`).toBeGreaterThan(0);
      }
    });

    it("all values match the naming pattern revenue.{entity}.{action}", () => {
      for (const [key, value] of entries) {
        expect(value, `COMMANDS.${key} ('${value}') should match pattern`).toMatch(TOPIC_PATTERN);
      }
    });
  });

  describe("EVENTS", () => {
    const entries = Object.entries(EVENTS);

    it("has at least one event defined", () => {
      expect(entries.length).toBeGreaterThan(0);
    });

    it("all values are non-empty strings", () => {
      for (const [key, value] of entries) {
        expect(value, `EVENTS.${key} should be a non-empty string`).toBeTruthy();
        expect(typeof value, `EVENTS.${key} should be a string`).toBe("string");
        expect(value.length, `EVENTS.${key} should not be empty`).toBeGreaterThan(0);
      }
    });

    it("all values match the naming pattern revenue.{entity}.{action}", () => {
      for (const [key, value] of entries) {
        expect(value, `EVENTS.${key} ('${value}') should match pattern`).toMatch(TOPIC_PATTERN);
      }
    });
  });

  describe("CONSUMED_EVENTS", () => {
    const entries = Object.entries(CONSUMED_EVENTS);

    it("has at least one consumed event defined", () => {
      expect(entries.length).toBeGreaterThan(0);
    });

    it("all values are non-empty strings", () => {
      for (const [key, value] of entries) {
        expect(value, `CONSUMED_EVENTS.${key} should be a non-empty string`).toBeTruthy();
        expect(typeof value, `CONSUMED_EVENTS.${key} should be a string`).toBe("string");
        expect(value.length, `CONSUMED_EVENTS.${key} should not be empty`).toBeGreaterThan(0);
      }
    });

    it("all values match the naming pattern {service}.{entity}.{action}", () => {
      for (const [key, value] of entries) {
        expect(value, `CONSUMED_EVENTS.${key} ('${value}') should match pattern`).toMatch(TOPIC_PATTERN);
      }
    });
  });
});

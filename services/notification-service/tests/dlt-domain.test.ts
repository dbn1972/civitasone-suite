/**
 * Notification DLT Templates — Domain Tests
 *
 * Module: services/notification-service/src/modules/dlt
 * Pack: Notification_Module_Test_Pack/11_DLT_Test_Prompt.md
 *
 * Tests:
 *   1. validateDltTemplate: pattern matching with {#var#} placeholders
 *   2. requiresDlt: channel gate (sms/whatsapp require DLT, others don't)
 *   3. Edge cases: exact match (no vars), trailing var, consecutive vars
 *   4. TRAI compliance: message MUST match a registered template
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("../src/shared/infra.js", () => ({ cache: { makeKey: (...p: string[]) => p.join(":"), getOrLoad: vi.fn(async (_k: string, fn: () => Promise<unknown>) => fn()) } }));
vi.mock("../src/modules/dlt/repo.js", () => ({ findActiveByChannel: vi.fn(async () => []) }));

import { validateDltTemplate } from "../src/modules/dlt/validate.js";
import { requiresDlt } from "../src/modules/dlt/guard.js";

// ─── 1. validateDltTemplate — pattern matching ───────────────────────────────

describe("validateDltTemplate — DLT template pattern matching", () => {
  describe("single variable", () => {
    it("matches message with one variable substituted", () => {
      const pattern = "Your OTP is {#var#}. Do not share.";
      const message = "Your OTP is 123456. Do not share.";
      expect(validateDltTemplate(message, pattern)).toBe(true);
    });

    it("variable must consume at least 1 character", () => {
      const pattern = "Hello {#var#}, welcome!";
      const message = "Hello , welcome!"; // empty variable
      expect(validateDltTemplate(message, pattern)).toBe(false);
    });

    it("variable can consume multiple words/chars", () => {
      const pattern = "Dear {#var#}, your application is approved.";
      const message = "Dear Mr. Ramesh Kumar Singh, your application is approved.";
      expect(validateDltTemplate(message, pattern)).toBe(true);
    });
  });

  describe("multiple variables", () => {
    it("matches with two variables", () => {
      const pattern = "Your order {#var#} of Rs {#var#} is confirmed.";
      const message = "Your order ORD-12345 of Rs 5000 is confirmed.";
      expect(validateDltTemplate(message, pattern)).toBe(true);
    });

    it("matches with three variables", () => {
      const pattern = "{#var#} has approved your {#var#} for Rs {#var#}.";
      const message = "Director has approved your leave for Rs 5000.";
      expect(validateDltTemplate(message, pattern)).toBe(true);
    });

    it("each variable must consume at least 1 char", () => {
      const pattern = "{#var#} and {#var#}";
      const message = "A and "; // second var is empty
      expect(validateDltTemplate(message, pattern)).toBe(false);
    });
  });

  describe("no variables — exact match required", () => {
    it("exact text matches", () => {
      const pattern = "This is a fixed notification.";
      expect(validateDltTemplate("This is a fixed notification.", pattern)).toBe(true);
    });

    it("different text fails", () => {
      const pattern = "Fixed text A.";
      expect(validateDltTemplate("Fixed text B.", pattern)).toBe(false);
    });

    it("extra characters fail", () => {
      const pattern = "Hello";
      expect(validateDltTemplate("Hello World", pattern)).toBe(false);
    });
  });

  describe("trailing variable", () => {
    it("pattern ending with {#var#} matches trailing content", () => {
      const pattern = "Ref: {#var#}";
      const message = "Ref: TXN-2026-001";
      expect(validateDltTemplate(message, pattern)).toBe(true);
    });

    it("trailing var must have at least 1 char", () => {
      const pattern = "Ref: {#var#}";
      const message = "Ref: "; // empty trailing
      expect(validateDltTemplate(message, pattern)).toBe(false);
    });
  });

  describe("leading variable", () => {
    it("pattern starting with {#var#} matches leading content", () => {
      const pattern = "{#var#} has been dispatched.";
      const message = "Order ORD-123 has been dispatched.";
      expect(validateDltTemplate(message, pattern)).toBe(true);
    });
  });

  describe("boundary characters in template", () => {
    it("handles special regex characters in literal parts", () => {
      const pattern = "Amount: Rs. {#var#} (incl. GST)";
      const message = "Amount: Rs. 5000 (incl. GST)";
      expect(validateDltTemplate(message, pattern)).toBe(true);
    });
  });

  describe("mismatch cases", () => {
    it("wrong literal text → no match", () => {
      const pattern = "Your OTP is {#var#}. Do not share.";
      const message = "Your PIN is 1234. Do not share.";
      expect(validateDltTemplate(message, pattern)).toBe(false);
    });

    it("missing trailing literal → no match", () => {
      const pattern = "Hello {#var#}, goodbye!";
      const message = "Hello World, see you!";
      expect(validateDltTemplate(message, pattern)).toBe(false);
    });
  });
});

// ─── 2. requiresDlt — channel gate ───────────────────────────────────────────

describe("requiresDlt — channel requires DLT validation", () => {
  it("sms → requires DLT", () => expect(requiresDlt("sms")).toBe(true));
  it("whatsapp → requires DLT", () => expect(requiresDlt("whatsapp")).toBe(true));
  it("email → does NOT require DLT", () => expect(requiresDlt("email")).toBe(false));
  it("push → does NOT require DLT", () => expect(requiresDlt("push")).toBe(false));
  it("in_app → does NOT require DLT", () => expect(requiresDlt("in_app")).toBe(false));
});

import { describe, expect, it } from "vitest";
import { validateActivityForm } from "./activityFormSchema";

describe("validateActivityForm (mirrors crm-service createActivityBody)", () => {
  it("accepts a normal note", () => {
    expect(validateActivityForm({ subject: "Call", text: "Spoke to the ward office" })).toEqual({});
  });
  it("rejects blank / whitespace-only notes", () => {
    expect(validateActivityForm({ subject: "", text: "   " }).text).toMatch(/notes/i);
  });
  it("rejects notes over 2000 chars and subjects over 200 chars", () => {
    const errs = validateActivityForm({ subject: "s".repeat(201), text: "t".repeat(2001) });
    expect(errs.text).toMatch(/2000/);
    expect(errs.subject).toMatch(/200/);
  });
});

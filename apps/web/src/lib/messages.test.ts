import { describe, it, expect } from "vitest";
import { toHumanError, ACTION_LABELS, type MessageKind } from "./messages";
import { findBannedTerms } from "./labels";

const KINDS: MessageKind[] = ["load", "save", "offline", "unknownStatus", "accepted"];

describe("human error vocabulary (R5, R6)", () => {
  it.each(KINDS)("%s message has plain what + next and a safe action", (kind) => {
    const m = toHumanError(kind, { area: "bill" });
    expect(m.what.trim().length).toBeGreaterThan(0); // R6.1
    expect(m.next.trim().length).toBeGreaterThan(0); // R6.2
    expect(m.actions.length).toBeGreaterThanOrEqual(1); // R6.3
  });

  it.each(KINDS)("%s message contains no transport detail or jargon", (kind) => {
    const m = toHumanError(kind);
    const copy = `${m.what} ${m.next}`;
    expect(findBannedTerms(copy), `banned terms in ${kind}`).toEqual([]); // R5.2, R5.4
    // No bare HTTP status codes (e.g. 404, 500, 202).
    expect(/\b[1-5]\d\d\b/.test(copy), `status code in ${kind}`).toBe(false); // R5.1
  });

  it("provides labels for every safe action", () => {
    expect(ACTION_LABELS.retry).toBeTruthy();
    expect(ACTION_LABELS.back).toBeTruthy();
    expect(ACTION_LABELS.help).toBeTruthy();
  });

  describe("load-failure copy (grammar + honesty regression)", () => {
    it.each(["projects", "employees", "indents", "KPIs"])(
      "does not read 'this %s' for a plural area",
      (area) => {
        const m = toHumanError("load", { area });
        expect(m.what).toBe(`We couldn't load ${area}.`);
        expect(m.what).not.toMatch(/\bthis\b/i);
      },
    );

    it("still reads correctly for a singular area", () => {
      const m = toHumanError("load", { area: "project" });
      expect(m.what).toBe("We couldn't load project.");
    });

    it("never blames the clerk's own internet connection", () => {
      const m = toHumanError("load", { area: "projects" });
      expect(m.next).not.toMatch(/internet connection/i);
    });

    it("the offline kind (genuinely a connectivity issue) is unaffected", () => {
      const m = toHumanError("offline");
      expect(m.next).toMatch(/internet/i);
    });
  });

  describe("unknownStatus copy (same 'this' + plural fix)", () => {
    it.each(["projects", "employees"])("does not read 'this %s'", (area) => {
      const m = toHumanError("unknownStatus", { area });
      expect(m.what).toBe(`We couldn't check the status of ${area}.`);
      expect(m.what).not.toMatch(/\bthis\b/i);
    });
  });
});

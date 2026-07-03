import { describe, it, expect } from "vitest";
import { LABELS, BANNED_CLERK_TERMS, findBannedTerms } from "./labels";

describe("labels", () => {
  it("exposes tenant label as 'office'", () => {
    expect(LABELS.tenant).toBe("office");
  });

  it("exposes sendForApproval label", () => {
    expect(LABELS.sendForApproval).toBe("Send for approval");
  });

  it("exposes module toggle labels", () => {
    expect(LABELS.moduleToggleOn).toBe("Turn on");
    expect(LABELS.moduleToggleOff).toBe("Turn off");
  });
});

describe("BANNED_CLERK_TERMS", () => {
  it("includes 'tenant'", () => {
    expect(BANNED_CLERK_TERMS).toContain("tenant");
  });

  it("includes 'cqrs'", () => {
    expect(BANNED_CLERK_TERMS).toContain("cqrs");
  });

  it("includes 'stack trace'", () => {
    expect(BANNED_CLERK_TERMS).toContain("stack trace");
  });
});

describe("findBannedTerms", () => {
  it("returns empty array for clean copy", () => {
    expect(findBannedTerms("Your bill has been approved")).toEqual([]);
  });

  it("detects 'tenant' in clerk-facing copy", () => {
    const result = findBannedTerms("Contact your tenant administrator");
    expect(result).toContain("tenant");
  });

  it("detects multiple banned terms", () => {
    const result = findBannedTerms("The outbox is full, check the dead-letter queue");
    expect(result).toContain("outbox");
    expect(result).toContain("dead-letter");
  });

  it("is case-insensitive", () => {
    expect(findBannedTerms("CQRS pattern failed")).toContain("cqrs");
  });

  it("detects 'enablement'", () => {
    expect(findBannedTerms("Module enablement is required")).toContain("enablement");
  });

  it("detects 'maker-checker'", () => {
    expect(findBannedTerms("Maker-Checker workflow")).toContain("maker-checker");
  });

  it("does not false-positive on partial matches that are not banned", () => {
    // "ten" is in "tenant" but "ten" alone is not banned
    expect(findBannedTerms("ten items found")).toEqual([]);
  });
});

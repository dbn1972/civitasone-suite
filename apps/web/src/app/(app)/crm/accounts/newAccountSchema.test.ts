import { describe, it, expect } from "vitest";
import { validateNewAccount } from "./newAccountSchema";

describe("validateNewAccount (GAP-CRM-ACCOUNTS-04)", () => {
  it("accepts a valid account and normalises a bare-domain website to https", () => {
    const r = validateNewAccount({ name: "Directorate", industry: "Government", website: "example.gov.in", parentId: "" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.website).toBe("https://example.gov.in/");
  });

  it("rejects a too-short name", () => {
    const r = validateNewAccount({ name: "A", industry: "", website: "", parentId: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.name).toBeDefined();
  });

  it("rejects a javascript: website", () => {
    const r = validateNewAccount({ name: "Directorate", industry: "", website: "javascript:alert(1)", parentId: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.website).toBeDefined();
  });

  it("allows an empty optional website", () => {
    const r = validateNewAccount({ name: "Directorate", industry: "", website: "", parentId: "" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.website).toBeUndefined();
  });
});

import { describe, it, expect } from "vitest";
import { safeExternalUrl } from "./url";

describe("safeExternalUrl (GAP-CRM-ACCOUNTS-DETAIL-05)", () => {
  it("rejects javascript: URLs", () => {
    expect(safeExternalUrl("javascript:alert(1)")).toBeNull();
    expect(safeExternalUrl("  javascript:alert(1)  ")).toBeNull();
  });

  it("rejects data: and other non-http schemes", () => {
    expect(safeExternalUrl("data:text/html,<script>1</script>")).toBeNull();
    expect(safeExternalUrl("mailto:x@example.com")).toBeNull();
    expect(safeExternalUrl("ftp://example.com")).toBeNull();
  });

  it("prefixes https:// for a bare domain", () => {
    expect(safeExternalUrl("example.com")).toBe("https://example.com/");
    expect(safeExternalUrl("ndma.gov.in/path")).toBe("https://ndma.gov.in/path");
  });

  it("keeps a valid http(s) URL", () => {
    expect(safeExternalUrl("https://example.gov.in")).toBe("https://example.gov.in/");
    expect(safeExternalUrl("http://example.gov.in")).toBe("http://example.gov.in/");
  });

  it("returns null for empty / non-string input", () => {
    expect(safeExternalUrl("")).toBeNull();
    expect(safeExternalUrl("   ")).toBeNull();
    expect(safeExternalUrl(null)).toBeNull();
    expect(safeExternalUrl(undefined)).toBeNull();
  });
});

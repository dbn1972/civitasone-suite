import { describe, expect, it } from "vitest";
import { safeHttpUrl, safeInternalPath } from "./safeUrl";

describe("safeHttpUrl", () => {
  it("passes an https URL through", () => {
    expect(safeHttpUrl("https://x.gov.in/a")).toBe("https://x.gov.in/a");
  });

  it("passes an http URL through", () => {
    expect(safeHttpUrl("http://x.gov.in/")).toBe("http://x.gov.in/");
  });

  it("rejects a javascript: URL", () => {
    expect(safeHttpUrl("javascript:alert(1)")).toBeNull();
  });

  it("rejects a data: URL", () => {
    expect(safeHttpUrl("data:text/html,<script>alert(1)</script>")).toBeNull();
  });

  it("rejects a vbscript: URL", () => {
    expect(safeHttpUrl("vbscript:msgbox(1)")).toBeNull();
  });

  it("rejects a relative URL (no scheme/host to trust)", () => {
    expect(safeHttpUrl("/relative/path")).toBeNull();
    expect(safeHttpUrl("relative/path")).toBeNull();
  });

  it("rejects empty / nullish input", () => {
    expect(safeHttpUrl("")).toBeNull();
    expect(safeHttpUrl("   ")).toBeNull();
    expect(safeHttpUrl(null)).toBeNull();
    expect(safeHttpUrl(undefined)).toBeNull();
  });

  it("trims surrounding whitespace before parsing", () => {
    expect(safeHttpUrl("  https://x.gov.in/a  ")).toBe("https://x.gov.in/a");
  });

  it("rejects a javascript: URL with leading whitespace tricks", () => {
    expect(safeHttpUrl("  javascript:alert(1)")).toBeNull();
  });
});

describe("safeInternalPath", () => {
  it("keeps same-origin paths with query and hash", () => {
    expect(safeInternalPath("/hr/leave/balance?empId=e-1#top")).toBe("/hr/leave/balance?empId=e-1#top");
    expect(safeInternalPath("/finance")).toBe("/finance");
  });
  it("rejects anything that could leave the app or run script", () => {
    for (const bad of ["//evil.example/x", "/\\evil.example", "javascript:alert(1)", "data:text/html,x", "https://x.gov.in/a", "hr/relative", "", null, undefined]) {
      expect(safeInternalPath(bad as string)).toBe("/");
    }
  });
  it("uses the caller fallback", () => {
    expect(safeInternalPath("javascript:x", "/hr")).toBe("/hr");
  });
});

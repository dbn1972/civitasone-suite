import { describe, expect, it } from "vitest";
import { safeHttpUrl } from "./safeUrl";

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

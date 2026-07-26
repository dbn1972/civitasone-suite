/** CAP-040 — closure/reopen/archival lifecycle guards. */
import { describe, it, expect } from "vitest";
import { canClose, canReopen, canArchive, initialStatus } from "../src/modules/closure/domain.js";

describe("closure lifecycle guards", () => {
  it("starts open", () => {
    expect(initialStatus()).toBe("open");
  });
  it("close allowed from open/reopened with a reason", () => {
    expect(canClose("open", "done").allowed).toBe(true);
    expect(canClose("reopened", "done").allowed).toBe(true);
    expect(canClose("open", " ").errors).toContain("REASON_REQUIRED");
    expect(canClose("closed", "x").errors).toContain("NOT_CLOSEABLE");
    expect(canClose("archived", "x").errors).toContain("NOT_CLOSEABLE");
  });
  it("reopen allowed only from closed with a reason", () => {
    expect(canReopen("closed", "mistake").allowed).toBe(true);
    expect(canReopen("open", "x").errors).toContain("NOT_REOPENABLE");
    expect(canReopen("archived", "x").errors).toContain("NOT_REOPENABLE");
    expect(canReopen("closed", "").errors).toContain("REASON_REQUIRED");
  });
  it("archive allowed only from closed", () => {
    expect(canArchive("closed").allowed).toBe(true);
    expect(canArchive("open").errors).toContain("MUST_BE_CLOSED");
    expect(canArchive("archived").errors).toContain("MUST_BE_CLOSED");
  });
});

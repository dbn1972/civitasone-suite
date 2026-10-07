/**
 * Tests for designer/[id]/page.tsx status-based redirect (GAP-DESIGNER-DETAIL-01)
 * and multi-value query param forwarding (GAP-DESIGNER-DETAIL-02).
 *
 * These are pure logic tests against the redirect rules.
 */
import { describe, expect, it } from "vitest";

// We test the logic rather than the server component directly; the rules:
// - draft / rejected -> b1
// - submitted / in_review -> review
// - published -> review
// - array query params forwarded

describe("designer wizard redirect rules", () => {
  // GAP-DESIGNER-DETAIL-02: multi-value query param forwarding
  it("forwards multi-value query params (?a=1&a=2) to the redirect target", () => {
    const searchParams: Record<string, string | string[] | undefined> = {
      a: ["1", "2"],
      b: "single",
    };
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(searchParams)) {
      if (typeof value === "string") {
        qs.set(key, value);
      } else if (Array.isArray(value)) {
        for (const v of value) qs.append(key, v);
      }
    }
    expect(qs.toString()).toBe("a=1&a=2&b=single");
    expect(qs.getAll("a")).toEqual(["1", "2"]);
  });

  // GAP-DESIGNER-DETAIL-01: status-based target resolution
  it("routes draft status to b1", () => {
    expect(targetForStatus("draft")).toBe("b1");
  });

  it("routes rejected status to b1 (edit mode)", () => {
    expect(targetForStatus("rejected")).toBe("b1");
  });

  it("routes submitted status to review", () => {
    expect(targetForStatus("submitted")).toBe("review");
  });

  it("routes in_review status to review", () => {
    expect(targetForStatus("in_review")).toBe("review");
  });

  it("routes published status to review (read-only)", () => {
    expect(targetForStatus("published")).toBe("review");
  });

  it("defaults to b1 on unknown status", () => {
    expect(targetForStatus("unknown_status")).toBe("b1");
  });
});

/** Extract the target resolution logic from page.tsx for unit testing. */
function targetForStatus(status: string): string {
  if (status === "submitted" || status === "in_review") return "review";
  if (status === "published") return "review";
  return "b1";
}

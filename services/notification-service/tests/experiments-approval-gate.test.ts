import { describe, it, expect } from "vitest";
import { assertCanApproveWinner, assertCanRequestConclusion } from "../src/modules/experiments/domain.js";

describe("P2-9 winner approval gate", () => {
  it("allows conclusion request only from running/draft", () => {
    expect(assertCanRequestConclusion("running")).toBeNull();
    expect(assertCanRequestConclusion("pending_approval")).toBe("ALREADY_PENDING_APPROVAL");
    expect(assertCanRequestConclusion("concluded")).toBe("ALREADY_CONCLUDED");
  });

  it("allows approve-winner only when pending approval", () => {
    expect(assertCanApproveWinner("pending_approval")).toBeNull();
    expect(assertCanApproveWinner("running")).toBe("NOT_PENDING_APPROVAL");
    expect(assertCanApproveWinner("concluded")).toBe("ALREADY_CONCLUDED");
  });
});

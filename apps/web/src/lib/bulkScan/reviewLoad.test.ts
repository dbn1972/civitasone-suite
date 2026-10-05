import { describe, it, expect } from "vitest";
import { reviewLoadFailures } from "./reviewLoad";

describe("reviewLoadFailures", () => {
  it("a failed queue or awaiting-links load is a failure, an empty successful one is not", () => {
    expect(reviewLoadFailures({ source: "error" }, { source: "api" })).toEqual({ queueFailed: true, awaitingFailed: false });
    expect(reviewLoadFailures({ source: "api" }, { source: "error" })).toEqual({ queueFailed: false, awaitingFailed: true });
    expect(reviewLoadFailures({ source: "api" }, { source: "api" })).toEqual({ queueFailed: false, awaitingFailed: false });
  });
});

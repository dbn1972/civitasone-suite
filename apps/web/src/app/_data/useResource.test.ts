import { describe, it, expect } from "vitest";
import { useResource, combineResourceState } from "./useResource";
import type { LoaderResult } from "./apiClient";

describe("useResource", () => {
  it("returns status=error when the loader reports source: error, regardless of the empty payload's shape", () => {
    const result: LoaderResult<string[]> = { data: [], source: "error" };
    expect(useResource(result)).toEqual({ status: "error", data: [], source: "error" });
  });

  it("returns status=error even when the error fallback data is non-empty (never trust error-path data)", () => {
    const result: LoaderResult<string[]> = { data: ["stale"], source: "error" };
    expect(useResource(result).status).toBe("error");
  });

  it("returns status=empty for a genuinely empty successful fetch", () => {
    const result: LoaderResult<string[]> = { data: [], source: "api" };
    expect(useResource(result)).toEqual({ status: "empty", data: [], source: "api" });
  });

  it("returns status=ready for a successful fetch with data", () => {
    const result: LoaderResult<string[]> = { data: ["a"], source: "api" };
    expect(useResource(result)).toEqual({ status: "ready", data: ["a"], source: "api" });
  });

  it("uses a custom isEmpty predicate instead of the array-length default", () => {
    const result: LoaderResult<{ count: number }> = { data: { count: 0 }, source: "api" };
    const state = useResource(result, (d) => d.count === 0);
    expect(state.status).toBe("empty");
  });

  it("custom isEmpty is not consulted on the error branch", () => {
    const result: LoaderResult<{ count: number }> = { data: { count: 5 }, source: "error" };
    const state = useResource(result, () => {
      throw new Error("should not be called on the error branch");
    });
    expect(state.status).toBe("error");
  });
});

describe("combineResourceState", () => {
  it("is status=error when any input loader errored, even if others succeeded", () => {
    const results: Array<LoaderResult<unknown>> = [
      { data: [1], source: "api" },
      { data: [], source: "error" },
    ];
    expect(combineResourceState(results, [1]).status).toBe("error");
  });

  it("is status=empty only when every input succeeded and the derived data is empty", () => {
    const results: Array<LoaderResult<unknown>> = [
      { data: [], source: "api" },
      { data: [], source: "api" },
    ];
    expect(combineResourceState(results, []).status).toBe("empty");
  });

  it("is status=ready when every input succeeded and the derived data is non-empty", () => {
    const results: Array<LoaderResult<unknown>> = [
      { data: [1], source: "api" },
      { data: [2], source: "api" },
    ];
    expect(combineResourceState(results, [1, 2]).status).toBe("ready");
  });
});

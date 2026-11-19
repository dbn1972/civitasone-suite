/**
 * Operations "Recent errors" feed: expected business rejections (controls working) are excluded;
 * genuine system faults are kept.
 */
import { describe, it, expect } from "vitest";
import { isExpectedBusinessRejection } from "../src/modules/health/operations.js";

describe("isExpectedBusinessRejection", () => {
  it("excludes an UNKNOWN_VENDOR worker rejection", () => {
    expect(isExpectedBusinessRejection("Error: UNKNOWN_VENDOR: 8c3a147e-3f69-4607-b9b2-21277c50c473 not found in vendor master for tenant")).toBe(true);
  });
  it("excludes bracketed and prefixed rejection codes", () => {
    expect(isExpectedBusinessRejection("[finance/payments] [NO_BUDGET_PROVISION] no budget provision for head X")).toBe(true);
    expect(isExpectedBusinessRejection("Error: PERIOD_CLOSED: period is closed")).toBe(true);
  });
  it("keeps genuine system errors", () => {
    expect(isExpectedBusinessRejection("Error: connect ECONNREFUSED 127.0.0.1:5432")).toBe(false);
    expect(isExpectedBusinessRejection("Error: Request failed with status 500    at fetch (node:internal)")).toBe(false);
    expect(isExpectedBusinessRejection("unhandledRejection: TypeError: Cannot read properties of undefined")).toBe(false);
  });
  it("keeps a line that merely mentions a code without being the error token", () => {
    expect(isExpectedBusinessRejection("ECONNREFUSED while handling UNKNOWN_VENDOR lookup")).toBe(false);
  });
});

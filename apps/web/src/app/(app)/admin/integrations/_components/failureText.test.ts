import { describe, it, expect } from "vitest";
import { describeTestFailure } from "./failureText";

// GAP-ADMIN-INTEGRATIONS-04
describe("describeTestFailure", () => {
  it.each([
    ["ECONNREFUSED 10.0.0.5:443", /could not be reached/],
    ["getaddrinfo ENOTFOUND smtp.internal.example", /could not be reached/],
    ["ETIMEDOUT", /did not respond in time/],
    ["unable to verify the first certificate", /secure connection/i],
    ["HTTP 401 Unauthorized", /rejected the credentials/],
    ["something odd", /did not succeed/],
  ])("%s -> plain language, no host/port", (raw, re) => {
    const out = describeTestFailure("failed", raw);
    expect(out).toMatch(re);
    expect(out).not.toMatch(/10\.0\.0\.5|smtp\.internal|ECONN|ENOTFOUND/);
  });
  it("unconfigured has its own line", () => {
    expect(describeTestFailure("unconfigured", null)).toMatch(/Not configured/);
  });
});

import { describe, it, expect } from "vitest";
import { resolveSqsEndpoint } from "../src/bus.js";

describe("resolveSqsEndpoint", () => {
  it("prefers SQS_ENDPOINT_URL over AWS_ENDPOINT_URL", () => {
    expect(
      resolveSqsEndpoint({ SQS_ENDPOINT_URL: "http://localhost:9324", AWS_ENDPOINT_URL: "http://localhost:4566" }),
    ).toBe("http://localhost:9324");
  });
  it("falls back to AWS_ENDPOINT_URL when SQS_ENDPOINT_URL is unset", () => {
    expect(resolveSqsEndpoint({ AWS_ENDPOINT_URL: "http://localhost:4566" })).toBe("http://localhost:4566");
  });
  it("is undefined when neither is set (real AWS)", () => {
    expect(resolveSqsEndpoint({})).toBeUndefined();
  });
  it("treats an empty SQS_ENDPOINT_URL as unset (falls back, never real AWS)", () => {
    expect(resolveSqsEndpoint({ SQS_ENDPOINT_URL: "", AWS_ENDPOINT_URL: "http://localhost:4566" })).toBe("http://localhost:4566");
    expect(resolveSqsEndpoint({ SQS_ENDPOINT_URL: "", AWS_ENDPOINT_URL: "" })).toBeUndefined();
  });
  it("SQS_ENDPOINT_URL alone is honoured", () => {
    expect(resolveSqsEndpoint({ SQS_ENDPOINT_URL: "http://localhost:9324" })).toBe("http://localhost:9324");
  });
});

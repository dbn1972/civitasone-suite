import { describe, it, expect } from "vitest";
import { EOfficeClient, trimTrailingSlashes } from "./client.js";

describe("EOfficeClient baseUrl normalisation (CodeQL alert 937)", () => {
  it("strips trailing slashes", () => {
    expect(trimTrailingSlashes("http://eoffice.local///")).toBe("http://eoffice.local");
    expect(trimTrailingSlashes("http://eoffice.local")).toBe("http://eoffice.local");
    expect(trimTrailingSlashes("///")).toBe("");
  });

  it("is linear on a long run of slashes that is not at the end", () => {
    const evil = "http://h" + "/".repeat(300_000) + "x";
    const t0 = Date.now();
    expect(trimTrailingSlashes(evil)).toBe(evil);
    expect(Date.now() - t0).toBeLessThan(500);
  });

  it("constructor accepts a hostile baseUrl without hanging", () => {
    const t0 = Date.now();
    new EOfficeClient({ baseUrl: "http://h" + "/".repeat(300_000) + "x", token: () => "t", fetchImpl: (async () => new Response("{}")) as typeof fetch });
    expect(Date.now() - t0).toBeLessThan(500);
  });
});

import { describe, it, expect } from "vitest";
import { registerQuery } from "../src/modules/documents/validators.js";

describe("registerQuery.missingMandatory", () => {
  it("parses the literal string false as false (not truthy-coerced)", () => {
    expect(registerQuery.parse({ missingMandatory: "false" }).missingMandatory).toBe(false);
  });
  it("parses true as true and leaves absent as undefined", () => {
    expect(registerQuery.parse({ missingMandatory: "true" }).missingMandatory).toBe(true);
    expect(registerQuery.parse({}).missingMandatory).toBeUndefined();
  });
  it("rejects other values", () => {
    expect(registerQuery.safeParse({ missingMandatory: "yes" }).success).toBe(false);
  });
});

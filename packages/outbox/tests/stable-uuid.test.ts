import { describe, it, expect } from "vitest";
import { stableUuid, SYSTEM_ACTOR_ID } from "../src/index.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("stableUuid", () => {
  it("is deterministic: the same name always yields the same uuid (redelivery dedupes)", () => {
    const name = "9e8a3f52-cc84-4075-ae2a-6a8c604fa75b:grn:2cde60e0-c34d-4e61-9f6c-98c885f39e29";
    expect(stableUuid(name)).toBe(stableUuid(name));
  });

  it("different names yield different uuids", () => {
    expect(stableUuid("a:1")).not.toBe(stableUuid("a:2"));
    expect(stableUuid("a:1")).not.toBe(stableUuid("b:1"));
    expect(stableUuid("")).not.toBe(stableUuid(" "));
  });

  it("is a valid uuid string with the version-8 nibble and RFC 4122 variant (fits a uuid column)", () => {
    for (const n of ["", "x", "msg:line", "ünïcode:键", "a".repeat(5000)]) {
      expect(stableUuid(n)).toMatch(UUID_RE);
    }
  });

  it("the system actor id is itself a valid uuid", () => {
    expect(SYSTEM_ACTOR_ID).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});

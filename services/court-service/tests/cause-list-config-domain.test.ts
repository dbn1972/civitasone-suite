/** Pure-domain tests for owner decision #33: per-court cause-list slot / courtroom config namespaces. */
import { describe, it, expect } from "vitest";
import {
  slotNamespace, courtroomNamespace, DEFAULT_SLOTS, DEFAULT_COURTROOMS,
} from "../src/modules/cause-list/domain.js";
import { NAMESPACE_PATTERN } from "../src/modules/config-registry/domain.js";

const COURT = "11111111-2222-4333-8444-555555555555";

describe("cause-list slot / courtroom namespaces (owner decision #33)", () => {
  it("are per court: one namespace per court per concept, derived from the court id", () => {
    expect(slotNamespace(COURT)).toBe("cl_slot_11111111222243338444555555555555");
    expect(courtroomNamespace(COURT)).toBe("cl_room_11111111222243338444555555555555");
    expect(slotNamespace(COURT)).not.toBe(slotNamespace("aaaaaaaa-2222-4333-8444-555555555555"));
  });
  it("always satisfy the config engine's namespace pattern (<= 64 chars, lowercase snake)", () => {
    for (const ns of [slotNamespace(COURT), courtroomNamespace(COURT)]) {
      expect(ns).toMatch(NAMESPACE_PATTERN);
      expect(ns.length).toBeLessThanOrEqual(64);
    }
  });
  it("is case-insensitive on the court id (uuid text casing must not fork the namespace)", () => {
    expect(slotNamespace(COURT.toUpperCase())).toBe(slotNamespace(COURT));
  });
  it("rejects something that is not a uuid instead of building a bogus namespace", () => {
    expect(() => slotNamespace("not-a-uuid")).toThrow();
  });
  it("ships defaults: AM/PM slots and a first courtroom, all valid config keys", () => {
    expect([...DEFAULT_SLOTS]).toEqual(["AM-1", "AM-2", "PM-1", "PM-2"]);
    expect([...DEFAULT_COURTROOMS]).toEqual(["COURT-1"]);
  });
});

import { describe, it, expect } from "vitest";
import {
  causeListSlotNamespace, causeListCourtroomNamespace, DEFAULT_CAUSE_LIST_SLOTS, DEFAULT_CAUSE_LIST_COURTROOMS,
  effectiveCauseListOptions,
} from "./causeListConfig";

const COURT = "11111111-2222-4333-8444-555555555555";

// Owner decision #33: these MUST match services/court-service/src/modules/cause-list/domain.ts, or the console
// would read namespaces the service never seeded.
describe("cause-list config namespaces (parity with court-service)", () => {
  it("builds the same per-court namespaces and defaults as the service", () => {
    expect(causeListSlotNamespace(COURT)).toBe("cl_slot_11111111222243338444555555555555");
    expect(causeListCourtroomNamespace(COURT)).toBe("cl_room_11111111222243338444555555555555");
    expect(causeListSlotNamespace(COURT.toUpperCase())).toBe(causeListSlotNamespace(COURT));
    expect([...DEFAULT_CAUSE_LIST_SLOTS]).toEqual(["AM-1", "AM-2", "PM-1", "PM-2"]);
    expect([...DEFAULT_CAUSE_LIST_COURTROOMS]).toEqual(["COURT-1"]);
  });
});

describe("effectiveCauseListOptions", () => {
  const entry = (configKey: string, over: Record<string, unknown> = {}) => ({
    id: configKey, namespace: "ns", configKey, value: {}, label: null, description: null, active: true, sortOrder: 0, version: 1, ...over,
  });
  it("uses the court's own ACTIVE entries when any exist (authoritative, replaces the defaults), in sort order", () => {
    const out = effectiveCauseListOptions(
      [entry("B", { sortOrder: 2 }), entry("A", { sortOrder: 1 }), entry("OLD", { active: false })],
      DEFAULT_CAUSE_LIST_SLOTS,
    );
    expect(out).toEqual([{ value: "A", label: "A" }, { value: "B", label: "B" }]);
  });
  it("uses a configured label for display while keeping the key as the value", () => {
    expect(effectiveCauseListOptions([entry("AM-1", { label: "Morning 10:30" })], DEFAULT_CAUSE_LIST_SLOTS))
      .toEqual([{ value: "AM-1", label: "Morning 10:30" }]);
  });
  it("falls back to the defaults when the court has no active entries", () => {
    expect(effectiveCauseListOptions([], DEFAULT_CAUSE_LIST_SLOTS).map((o) => o.value)).toEqual(["AM-1", "AM-2", "PM-1", "PM-2"]);
    expect(effectiveCauseListOptions([entry("X", { active: false })], DEFAULT_CAUSE_LIST_COURTROOMS).map((o) => o.value)).toEqual(["COURT-1"]);
  });
});

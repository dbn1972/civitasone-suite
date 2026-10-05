import { describe, it, expect } from "vitest";
import {
  ACTIVITY_TYPES,
  LOGGABLE_ACTIVITY_TYPES,
  activityTypeLabel,
  type ActivityType,
} from "./activityTypes";
import enMessages from "@/messages/en.json";
import { mapCRMActivityEntries } from "../../../_data/loaders";

const ACTIVITY_TYPE_LABELS = enMessages.crmActivityTypes as Record<ActivityType, string>;
const tType = (key: ActivityType): string => ACTIVITY_TYPE_LABELS[key];

describe("activity types (GAP-CRM-ACTIVITIES-01)", () => {
  it("does not offer 'site_visit' in the log form (the backend rejects it)", () => {
    expect((LOGGABLE_ACTIVITY_TYPES as readonly string[]).includes("site_visit")).toBe(false);
  });

  it("every loggable type is a recognised activity type (form <-> mapper cannot drift)", () => {
    for (const t of LOGGABLE_ACTIVITY_TYPES) {
      expect((ACTIVITY_TYPES as readonly string[]).includes(t)).toBe(true);
      expect(ACTIVITY_TYPE_LABELS[t]).toBeTruthy();
    }
  });

  it("humanises known types and falls back to the raw value", () => {
    expect(activityTypeLabel("appointment", tType)).toBe("Appointment");
    expect(activityTypeLabel("call", tType)).toBe("Call");
    expect(activityTypeLabel("whatever", tType)).toBe("whatever");
  });
});

describe("mapCRMActivityEntries (GAP-CRM-ACTIVITIES-01)", () => {
  it("keeps a row whose type is now a recognised backend type (appointment)", () => {
    const out = mapCRMActivityEntries([
      { id: "1", type: "appointment", subject: "Site visit", status: "open", owner: "Ravi" },
    ]);
    expect(out).toHaveLength(1);
    expect(out?.[0].type).toBe("appointment");
  });

  it("keeps reminder and complaint rows instead of silently dropping them", () => {
    const out = mapCRMActivityEntries([
      { id: "1", type: "reminder", subject: "Call back", status: "open", owner: "A" },
      { id: "2", type: "complaint", subject: "Noise", status: "open", owner: "B" },
    ]);
    expect(out).toHaveLength(2);
    expect(out?.map((e) => e.type).sort()).toEqual(["complaint", "reminder"]);
  });

  it("does not drop a row with an unknown type — it falls back to 'note'", () => {
    const out = mapCRMActivityEntries([
      { id: "1", type: "site_visit", subject: "Legacy visit", status: "open", owner: "A" },
    ]);
    expect(out).toHaveLength(1);
    expect(out?.[0].type).toBe("note");
    expect(out?.[0].subject).toBe("Legacy visit");
  });

  it("still drops rows missing an id or subject (but returns [] not null)", () => {
    const out = mapCRMActivityEntries([
      { type: "call", status: "open", owner: "A" }, // no id
      { id: "2", type: "call", status: "open", owner: "A" }, // no subject
    ]);
    // GAP-CRM-ACTIVITIES-04: a valid array with no mappable rows is still a
    // valid (empty) list, not an error.
    expect(out).toEqual([]);
  });
});

describe("mapCRMActivityEntries empty/status handling (GAP-CRM-ACTIVITIES-04)", () => {
  it("returns [] (not null) for an empty but valid array", () => {
    expect(mapCRMActivityEntries([])).toEqual([]);
  });

  it("returns null only for a non-array payload", () => {
    expect(mapCRMActivityEntries({ not: "an array" })).toBeNull();
    expect(mapCRMActivityEntries(null)).toBeNull();
  });

  it("keeps a cancelled activity", () => {
    const out = mapCRMActivityEntries([
      { id: "1", type: "task", subject: "Dropped task", status: "cancelled", owner: "A" },
    ]);
    expect(out).toHaveLength(1);
    expect(out?.[0].status).toBe("cancelled");
  });

  it("coerces an unknown status to 'open' instead of dropping the row", () => {
    const out = mapCRMActivityEntries([
      { id: "1", type: "task", subject: "In progress", status: "in_progress", owner: "A" },
    ]);
    expect(out).toHaveLength(1);
    expect(out?.[0].status).toBe("open");
  });
});

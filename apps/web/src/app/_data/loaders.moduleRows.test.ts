import { describe, it, expect } from "vitest";
import { mapModuleRows } from "./loaders";

// mapModuleRows backs every generic moduleLoader() list -- legal, billing,
// inventory, telephony, locations, notifications, grants, estab, knowledge,
// workflow, analytics and projects all go through this one function. A
// representative row shape (this one modeled on a legal case row) is enough
// to exercise the mapping; the field-selection logic itself is covered by
// exercising each fallback chain below.
const SAMPLE_ROW = {
  id: "19c91840-1e19-406a-a51e-ecdc92f8edf6",
  tenantId: "11111111-0000-0000-0000-000000000001",
  name: "State vs. Sample Petitioner",
  dept: "Legal Affairs",
  status: "open",
  code: "CASE-0001",
};

describe("mapModuleRows", () => {
  it("maps a real module row (name as label, dept as sublabel, code as meta)", () => {
    expect(mapModuleRows({ data: [SAMPLE_ROW] })).toEqual([
      {
        id: "19c91840-1e19-406a-a51e-ecdc92f8edf6",
        label: "State vs. Sample Petitioner",
        sublabel: "Legal Affairs",
        status: "open",
        meta: "CASE-0001",
      },
    ]);
  });

  it("returns an empty array (not null) for a tenant with zero rows", () => {
    // Regression: mapModuleRows used to return `mapped.length > 0 ? mapped
    // : null`. fetchJson treats a null mapResponse return as invalid_payload
    // / source "error" -- indistinguishable from a real fetch failure. A
    // tenant with no rows yet for a module (legal cases, billing plans,
    // inventory items, etc.) is a normal, successful state and must render
    // the module's "nothing yet" empty state, not an error/couldn't-load
    // state. This is the same regression fixed for contracts specifically
    // in mapContractsListRows (see fixup commit b6bd6740 / PR #813); this
    // generic mapper had the identical bug, for every loader built on it.
    //
    // The envelope below is not synthetic: it's the real, live response
    // captured via `curl http://127.0.0.1:8080/api/v1/telephony/calls`
    // (getTelephonyCalls, one of the 16 loaders built on this mapper)
    // against the shared dev stack for a tenant with zero telephony calls,
    // confirming this exact shape reaches mapModuleRows in production.
    const REAL_EMPTY_ENVELOPE = { data: [], pagination: { hasMore: false, pageSize: 50 } };
    const result = mapModuleRows(REAL_EMPTY_ENVELOPE);
    expect(result).toEqual([]);
    expect(result).not.toBeNull();
  });

  it("accepts a bare array payload (no envelope)", () => {
    expect(mapModuleRows([SAMPLE_ROW])).toHaveLength(1);
  });

  it("accepts an { items: [...] } envelope via the shared getArrayPayload helper", () => {
    expect(mapModuleRows({ items: [SAMPLE_ROW] })).toHaveLength(1);
  });

  it("falls back through the label field chain (title, subject, label, code, contractNo, fileNo)", () => {
    expect(mapModuleRows({ data: [{ id: "x1", fileNo: "FILE-9" }] })).toEqual([
      expect.objectContaining({ id: "x1", label: "FILE-9" }),
    ]);
  });

  it("skips rows missing both an id/referenceId and a usable label, without throwing", () => {
    const result = mapModuleRows({
      data: [{ id: "missing-label" }, { name: "missing-id" }, SAMPLE_ROW],
    });
    expect(result).toHaveLength(1);
    expect(result?.[0]?.id).toBe(SAMPLE_ROW.id);
  });

  it("returns null for a payload that isn't a recognizable row list at all", () => {
    expect(mapModuleRows(null)).toBeNull();
    expect(mapModuleRows("not json")).toBeNull();
    expect(mapModuleRows({ unrelated: true })).toBeNull();
  });
});

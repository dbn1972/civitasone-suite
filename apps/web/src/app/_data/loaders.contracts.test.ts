import { describe, it, expect } from "vitest";
import { mapContractsListRows } from "./loaders";

// Real GET /v1/contract/contracts response shape, captured live from the
// running contract-service dev stack (see fix/contract-frontend-field-mapping
// PR description for the exact curl output this mirrors).
const REAL_ENVELOPE = {
  data: [
    {
      id: "19c91840-1e19-406a-a51e-ecdc92f8edf6",
      tenantId: "11111111-0000-0000-0000-000000000001",
      contractNo: "CON-VERIFY-0001",
      vendorId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
      poRef: null,
      title: "Deep-verify probe contract",
      valueMinor: "123456789",
      currency: "INR",
      startDate: "2026-08-27",
      expiry: "2027-08-27",
      status: "draft",
      slaTerms: null,
    },
  ],
  pagination: { hasMore: false, pageSize: 50 },
};

describe("mapContractsListRows", () => {
  it("maps the real contract-service envelope shape (title as label, vendorId as sublabel, contractNo as meta)", () => {
    expect(mapContractsListRows(REAL_ENVELOPE)).toEqual([
      {
        id: "19c91840-1e19-406a-a51e-ecdc92f8edf6",
        label: "Deep-verify probe contract",
        sublabel: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
        status: "draft",
        meta: "CON-VERIFY-0001",
      },
    ]);
  });

  it("returns an empty array (not null) for a tenant with zero contracts", () => {
    // Regression: a mapper that returns null for a successfully-parsed-but-
    // empty result gets treated by fetchJson as invalid_payload / source
    // "error" -- indistinguishable from a real fetch failure. A tenant with
    // no contracts yet is a normal, successful state and must render the
    // "no contracts" empty state, not an error/couldn't-load state.
    const result = mapContractsListRows({ data: [], pagination: { hasMore: false, pageSize: 50 } });
    expect(result).toEqual([]);
    expect(result).not.toBeNull();
  });

  it("accepts a bare array payload (no envelope)", () => {
    expect(mapContractsListRows([REAL_ENVELOPE.data[0]])).toHaveLength(1);
  });

  it("accepts an { items: [...] } envelope via the shared getArrayPayload helper", () => {
    expect(mapContractsListRows({ items: [REAL_ENVELOPE.data[0]] })).toHaveLength(1);
  });

  it("skips rows missing both an id and a usable label, without throwing", () => {
    const result = mapContractsListRows({
      data: [
        { id: "missing-label" },
        { title: "missing-id" },
        REAL_ENVELOPE.data[0],
      ],
    });
    expect(result).toHaveLength(1);
    expect(result?.[0]?.id).toBe("19c91840-1e19-406a-a51e-ecdc92f8edf6");
  });

  it("falls back to contractNo as the label when title is absent", () => {
    const { title: _title, ...rest } = REAL_ENVELOPE.data[0];
    expect(mapContractsListRows({ data: [rest] })).toEqual([
      expect.objectContaining({ label: "CON-VERIFY-0001" }),
    ]);
  });

  it("returns null for a payload that isn't a recognizable row list at all", () => {
    expect(mapContractsListRows(null)).toBeNull();
    expect(mapContractsListRows("not json")).toBeNull();
    expect(mapContractsListRows({ unrelated: true })).toBeNull();
  });
});

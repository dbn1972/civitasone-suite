import { describe, it, expect, vi } from "vitest";

const payloads = vi.hoisted(() => ({ byPath: {} as Record<string, unknown> }));
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: async (path: string, fallback: unknown, opts: { mapResponse: (p: unknown) => unknown }) => ({
    data: path in payloads.byPath ? opts.mapResponse(payloads.byPath[path]) : fallback,
    source: path in payloads.byPath ? "api" : "error",
  }),
}));

import { getLocationJurisdictionsTyped } from "./_data";

const OFFICE = "6b1a9c9e-6a53-4a51-9a40-8f7d7c1a0031";
const DISTRICT = "6b1a9c9e-6a53-4a51-9a40-8f7d7c1a0032";
const BLOCK = "6b1a9c9e-6a53-4a51-9a40-8f7d7c1a0033";
const ORPHAN = "6b1a9c9e-6a53-4a51-9a40-8f7d7c1a0034";

describe("getLocationJurisdictionsTyped: parent and LGD code (GAP-LOCATIONS-JURISDICTIONS-05)", () => {
  it("resolves the unit's parent name and LGD code from the administrative hierarchy, never a raw id", async () => {
    payloads.byPath = {
      "/api/v1/jurisdictions": { data: [
        { id: "j1", officeId: OFFICE, unitId: BLOCK, level: "block", isPrimary: true },
        { id: "j2", officeId: OFFICE, unitId: ORPHAN, level: "ward", isPrimary: false },
      ] },
      "/api/v1/locations?limit=500": { data: [{ id: OFFICE, name: "DM Office" }] },
      "/api/v1/hierarchy": { data: [
        { id: DISTRICT, name: "Patna", lgdCode: "212", children: [
          { id: BLOCK, name: "Sadar Block", parentId: DISTRICT, lgdCode: "2121" },
        ] },
        { id: ORPHAN, name: "Free Ward" },
      ] },
    };
    const r = await getLocationJurisdictionsTyped();
    expect(r.source).toBe("api");
    expect(r.data[0]).toMatchObject({ office: "DM Office", unit: "Sadar Block", parent: "Patna", lgdCode: "2121", level: "block", primary: true });
    // a unit with no parent / LGD code is blank, not a guess
    expect(r.data[1]).toMatchObject({ unit: "Free Ward", parent: "", lgdCode: "" });
    expect(JSON.stringify(r.data)).not.toContain(DISTRICT);
  });

  it("leaves parent and LGD code blank when the hierarchy cannot be read, without failing the register", async () => {
    payloads.byPath = {
      "/api/v1/jurisdictions": { data: [{ id: "j1", officeId: OFFICE, unitId: BLOCK, level: "block" }] },
    };
    const r = await getLocationJurisdictionsTyped();
    expect(r.data).toHaveLength(1);
    expect(r.data[0]).toMatchObject({ unit: "", parent: "", lgdCode: "" });
  });
});

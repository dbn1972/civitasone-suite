import { describe, it, expect, vi, afterEach } from "vitest";
import {
  searchInspectionEntities,
  resolveInspectionEntities,
  searchInspectionTypes,
  resolveInspectionTypes,
  searchInspections,
} from "./inspectionAssign";

const ENTITY = "44444444-4444-4444-8444-000000000004";

describe("inspectionAssign adapters (GAP-INSPECTION-ASSIGNMENTS-01)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("entity search hits the server full-text endpoint and labels name · reg · type", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ data: [{ id: ENTITY, name: "Acme Factory", registrationNo: "REG-9", entityType: "factory" }] }),
        { status: 200 },
      ),
    );
    const out = await searchInspectionEntities("acme", new AbortController().signal);
    expect(String(spy.mock.calls[0]![0])).toContain("/api/proxy/v1/inspection/entities?q=acme");
    expect(out).toEqual([{ id: ENTITY, label: "Acme Factory", sublabel: "REG-9 · factory" }]);
  });

  it("entity search returns [] (not throw) on failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("x", { status: 500 }));
    await expect(searchInspectionEntities("x", new AbortController().signal)).resolves.toEqual([]);
  });

  it("entity resolve reads the detail endpoint per id", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { id: ENTITY, name: "Acme Factory", registrationNo: "REG-9" } }), { status: 200 }),
    );
    expect(await resolveInspectionEntities([ENTITY])).toEqual([{ id: ENTITY, label: "Acme Factory", sublabel: "REG-9" }]);
  });

  it("inspection type search filters the bounded list client-side", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ data: [{ id: "t1", name: "Fire Safety", code: "FS" }, { id: "t2", name: "Hygiene", code: "HY" }] }),
        { status: 200 },
      ),
    );
    const out = await searchInspectionTypes("fire", new AbortController().signal);
    expect(out).toEqual([{ id: "t1", label: "Fire Safety", sublabel: "FS" }]);
  });

  it("inspection type resolve matches by id", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: "t1", name: "Fire Safety", code: "FS" }] }), { status: 200 }),
    );
    expect(await resolveInspectionTypes(["t1"])).toEqual([{ id: "t1", label: "Fire Safety", sublabel: "FS" }]);
  });

  it("inspection search labels by state + date + short id (never a fabricated name)", async () => {
    const id = "11111111-1111-4111-8111-000000000001";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id, state: "scheduled", createdAt: "2026-10-07T00:00:00Z" }] }), { status: 200 }),
    );
    const out = await searchInspections("", new AbortController().signal);
    expect(out[0]!.id).toBe(id);
    expect(out[0]!.label).toContain("scheduled");
    expect(out[0]!.label).toContain("2026-10-07");
    expect(out[0]!.label).toContain("#11111111");
  });
});

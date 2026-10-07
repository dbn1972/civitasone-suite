import { describe, it, expect } from "vitest";
import { __test } from "./_data";

const { mapRows, mapCatalog, mapHooks } = __test;

describe("plugins _data.mapRows — GAP-PLUGINS-HOOKS-03 / MARKETPLACE-04 / REGISTRY-03 (WIRING)", () => {
  it("returns null (-> source:error) for a bare error-shaped object, not a bogus row", () => {
    expect(mapRows({ error: "x", message: "y" })).toBeNull();
  });

  it("still maps a well-formed {data:[...]} envelope to one row", () => {
    const out = mapRows({ data: [{ id: "1", name: "p" }] });
    expect(out).toHaveLength(1);
    expect(out?.[0]).toMatchObject({ id: "1", label: "p" });
  });

  it("maps a bare array payload", () => {
    const out = mapRows([{ id: "1", name: "p" }]);
    expect(out).toHaveLength(1);
    expect(out?.[0]).toMatchObject({ id: "1", label: "p" });
  });

  it("skips rows with no real id (no synthetic row-N id)", () => {
    const out = mapRows({ data: [{ detail: "no identity" }, { id: "2", name: "ok" }] });
    expect(out).toEqual([{ id: "2", label: "ok" }]);
  });

  it("returns [] for a genuinely empty list (distinct from null)", () => {
    expect(mapRows({ data: [] })).toEqual([]);
  });
});

describe("plugins _data.mapCatalog — GAP-PLUGINS-REGISTRY-02 / MARKETPLACE-03 / HOOKS-02 (UUID)", () => {
  it("keeps name/status/version/publisher and pulls name+version from the manifest", () => {
    const out = mapCatalog({
      data: [
        {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          state: "enabled",
          manifestJson: { name: "Billing Connector", version: "2.1.0", publisher: "Acme" },
          updatedAt: "2026-09-20T00:00:00Z",
        },
      ],
    });
    expect(out).toEqual([
      {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        name: "Billing Connector",
        status: "enabled",
        version: "2.1.0",
        publisher: "Acme",
        updatedAt: "2026-09-20T00:00:00Z",
      },
    ]);
  });

  it("falls back to id as name when no name is present, omits absent fields", () => {
    const out = mapCatalog({ data: [{ id: "x1" }] });
    expect(out).toEqual([{ id: "x1", name: "x1" }]);
  });

  it("returns null for an unrecognised shape", () => {
    expect(mapCatalog({ error: "nope" })).toBeNull();
  });
});

describe("plugins _data.mapHooks — GAP-PLUGINS-HOOKS-01 (MISSINGFEATURE)", () => {
  it("keeps event, owner plugin, status (from active bool) and failures", () => {
    const out = mapHooks({
      data: [
        { id: "h1", eventType: "invoice.created", pluginId: "plug-9", active: true, failures: 3, lastRun: "2026-09-20T00:00:00Z" },
      ],
    });
    expect(out).toEqual([
      {
        id: "h1",
        event: "invoice.created",
        ownerPlugin: "plug-9",
        status: "enabled",
        failures: 3,
        lastRun: "2026-09-20T00:00:00Z",
      },
    ]);
  });

  it("maps active:false to disabled", () => {
    const out = mapHooks({ data: [{ id: "h2", eventType: "x", active: false }] });
    expect(out?.[0]).toMatchObject({ status: "disabled" });
  });
});

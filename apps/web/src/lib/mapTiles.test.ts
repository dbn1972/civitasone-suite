import { describe, it, expect } from "vitest";
import { configuredTileUrl, tileImgSource } from "./mapTiles";

describe("map tile config (GAP-LOCATIONS-MAPS-02)", () => {
  it("defaults to OpenStreetMap when unset", () => {
    expect(configuredTileUrl({})).toBeUndefined();
    expect(tileImgSource({})).toBe("https://*.tile.openstreetmap.org");
  });

  it("uses an internal https tile server and allows exactly its origin in the CSP", () => {
    const env = { MAP_TILE_URL: "https://tiles.internal.example.gov.in:8443/{z}/{x}/{y}.png" };
    expect(configuredTileUrl(env)).toBe(env.MAP_TILE_URL);
    expect(tileImgSource(env)).toBe("https://tiles.internal.example.gov.in:8443");
  });

  it("turns the {s} subdomain placeholder into a wildcard source", () => {
    expect(tileImgSource({ MAP_TILE_URL: "https://{s}.tiles.example.gov.in/{z}/{x}/{y}.png" })).toBe("https://*.tiles.example.gov.in");
  });

  it("ignores non-https values rather than widening the CSP", () => {
    for (const bad of ["http://tiles.example.gov.in/{z}/{x}/{y}.png", "javascript:alert(1)", "//tiles.example.gov.in/x", "  "]) {
      expect(configuredTileUrl({ MAP_TILE_URL: bad }), bad).toBeUndefined();
      expect(tileImgSource({ MAP_TILE_URL: bad }), bad).toBe("https://*.tile.openstreetmap.org");
    }
  });
});

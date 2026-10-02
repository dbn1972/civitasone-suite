import { describe, it, expect } from "vitest";
import { validateOfficeLocation, mapPreviewUrl } from "./officeLocationValidation";

const ok = { name: "HQ", address: "", latitude: "28.6139", longitude: "77.2090", radiusMeters: "200" };

describe("validateOfficeLocation (GAP-HR-LOCATIONS-NEW-02)", () => {
  it("accepts a valid geofence and parses numerics", () => {
    const r = validateOfficeLocation(ok);
    expect(r).toEqual({ ok: true, body: { name: "HQ", latitude: 28.6139, longitude: 77.209, radiusMeters: 200 } });
  });
  it("includes a trimmed address only when given", () => {
    const r = validateOfficeLocation({ ...ok, address: "  Sector 5  " });
    expect(r.ok && r.body.address).toBe("Sector 5");
  });
  it.each(["49", "5001", "0", "-10"])("rejects radius %s outside 50..5000", (radiusMeters) => {
    const r = validateOfficeLocation({ ...ok, radiusMeters });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.radiusMeters).toBeDefined();
  });
  it("rejects a fractional radius (server requires an integer)", () => {
    const r = validateOfficeLocation({ ...ok, radiusMeters: "200.5" });
    expect(!r.ok && r.errors.radiusMeters).toBe("invalid");
  });
  it("accepts the radius bounds 50 and 5000", () => {
    expect(validateOfficeLocation({ ...ok, radiusMeters: "50" }).ok).toBe(true);
    expect(validateOfficeLocation({ ...ok, radiusMeters: "5000" }).ok).toBe(true);
  });
  it("rejects out-of-range and non-numeric coordinates", () => {
    const r = validateOfficeLocation({ ...ok, latitude: "91", longitude: "abc" });
    expect(!r.ok && r.errors).toEqual({ latitude: "range", longitude: "invalid" });
  });
  it("requires a name and coordinates", () => {
    const r = validateOfficeLocation({ name: " ", address: "", latitude: "", longitude: "", radiusMeters: "" });
    expect(!r.ok && Object.keys(r.errors).sort()).toEqual(["latitude", "longitude", "name", "radiusMeters"]);
  });
  it("builds an OSM preview link", () => {
    expect(mapPreviewUrl(1.5, 2.5)).toContain("mlat=1.5&mlon=2.5");
  });
});

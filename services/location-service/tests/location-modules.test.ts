/**
 * location-service module tests — validators + consumer registration for
 * hierarchy, jurisdiction, geofence, and pincode modules.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { MemoryQueue } from "@civitasone/queue";

// ─── Hierarchy validators ───────────────────────────────────────────────────
import {
  createUnitBody,
  updateUnitBody,
  bulkSyncBody,
  UNIT_TYPES,
} from "../src/modules/hierarchy/validators.js";

// ─── Jurisdiction validators ────────────────────────────────────────────────
import {
  assignJurisdictionBody,
  jurisdictionQueryParams,
  JURISDICTION_LEVELS,
} from "../src/modules/jurisdiction/validators.js";

// ─── Geofence validators ────────────────────────────────────────────────────
import {
  createGeofenceBody,
  updateGeofenceBody,
  geofenceCheckBody,
  GEOFENCE_TYPES,
  haversineDistance,
  pointInPolygon,
} from "../src/modules/geofence/validators.js";

// ─── Pincode validators ─────────────────────────────────────────────────────
import {
  pincodeParam,
  pincodeSearchQuery,
  bulkImportBody,
} from "../src/modules/pincode/validators.js";

// ─── Consumer registrations ─────────────────────────────────────────────────
import { registerHierarchyConsumers } from "../src/modules/hierarchy/consumer.js";
import { registerJurisdictionConsumers } from "../src/modules/jurisdiction/consumer.js";
import { registerGeofenceConsumers } from "../src/modules/geofence/consumer.js";
import { registerPincodeConsumers } from "../src/modules/pincode/consumer.js";

// ═══════════════════════════════════════════════════════════════════════════════
// HIERARCHY MODULE
// ═══════════════════════════════════════════════════════════════════════════════
describe("hierarchy validators", () => {
  it("accepts a minimal create unit body", () => {
    const body = createUnitBody.parse({ code: "OD", name: "Odisha", type: "state" });
    expect(body.code).toBe("OD");
    expect(body.name).toBe("Odisha");
    expect(body.type).toBe("state");
  });

  it("accepts full create body with optional fields", () => {
    const body = createUnitBody.parse({
      code: "CTK",
      name: "Cuttack",
      type: "district",
      parentId: "11111111-aaaa-4000-8000-000000000001",
      population: 2600000,
      areaKm2: 3932,
      pinCodes: ["753001", "753002"],
      lgdCode: "361",
    });
    expect(body.type).toBe("district");
    expect(body.population).toBe(2600000);
    expect(body.pinCodes).toEqual(["753001", "753002"]);
  });

  it("rejects empty code", () => {
    expect(() => createUnitBody.parse({ code: "", name: "X", type: "state" })).toThrow();
  });

  it("rejects empty name", () => {
    expect(() => createUnitBody.parse({ code: "X", name: "", type: "state" })).toThrow();
  });

  it("rejects invalid unit type", () => {
    expect(() => createUnitBody.parse({ code: "X", name: "Y", type: "country" })).toThrow();
  });

  it("rejects negative population", () => {
    expect(() => createUnitBody.parse({ code: "X", name: "Y", type: "state", population: -1 })).toThrow();
  });

  it("rejects invalid PIN code in pinCodes array", () => {
    expect(() => createUnitBody.parse({ code: "X", name: "Y", type: "state", pinCodes: ["123"] })).toThrow();
  });

  it("rejects non-numeric LGD code", () => {
    expect(() => createUnitBody.parse({ code: "X", name: "Y", type: "state", lgdCode: "AB12" })).toThrow();
  });

  it("rejects non-uuid parentId", () => {
    expect(() => createUnitBody.parse({ code: "X", name: "Y", type: "state", parentId: "not-uuid" })).toThrow();
  });

  it("validates all defined unit types", () => {
    for (const t of UNIT_TYPES) {
      const body = createUnitBody.parse({ code: "X", name: "Y", type: t });
      expect(body.type).toBe(t);
    }
  });

  it("update body allows partial fields", () => {
    const body = updateUnitBody.parse({ name: "New Name" });
    expect(body.name).toBe("New Name");
    expect(body.population).toBeUndefined();
  });

  it("update body allows nullable parentId", () => {
    const body = updateUnitBody.parse({ parentId: null });
    expect(body.parentId).toBeNull();
  });

  it("bulk sync body requires at least one unit", () => {
    expect(() => bulkSyncBody.parse({ units: [] })).toThrow();
  });

  it("bulk sync body accepts valid batch", () => {
    const body = bulkSyncBody.parse({
      units: [
        { code: "OD", name: "Odisha", type: "state" },
        { code: "CTK", name: "Cuttack", type: "district" },
      ],
    });
    expect(body.units).toHaveLength(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// JURISDICTION MODULE
// ═══════════════════════════════════════════════════════════════════════════════
describe("jurisdiction validators", () => {
  it("accepts a valid assign body", () => {
    const body = assignJurisdictionBody.parse({
      officeId: "11111111-aaaa-4000-8000-000000000001",
      unitId: "22222222-bbbb-4000-8000-000000000002",
      level: "district",
    });
    expect(body.officeId).toBe("11111111-aaaa-4000-8000-000000000001");
    expect(body.isPrimary).toBe(false); // default
  });

  it("accepts isPrimary override", () => {
    const body = assignJurisdictionBody.parse({
      officeId: "11111111-aaaa-4000-8000-000000000001",
      unitId: "22222222-bbbb-4000-8000-000000000002",
      level: "state",
      isPrimary: true,
    });
    expect(body.isPrimary).toBe(true);
  });

  it("rejects invalid officeId", () => {
    expect(() => assignJurisdictionBody.parse({
      officeId: "not-uuid",
      unitId: "22222222-bbbb-4000-8000-000000000002",
      level: "district",
    })).toThrow();
  });

  it("rejects invalid unitId", () => {
    expect(() => assignJurisdictionBody.parse({
      officeId: "11111111-aaaa-4000-8000-000000000001",
      unitId: "bad",
      level: "district",
    })).toThrow();
  });

  it("rejects invalid jurisdiction level", () => {
    expect(() => assignJurisdictionBody.parse({
      officeId: "11111111-aaaa-4000-8000-000000000001",
      unitId: "22222222-bbbb-4000-8000-000000000002",
      level: "country",
    })).toThrow();
  });

  it("validates all jurisdiction levels", () => {
    for (const level of JURISDICTION_LEVELS) {
      const body = assignJurisdictionBody.parse({
        officeId: "11111111-aaaa-4000-8000-000000000001",
        unitId: "22222222-bbbb-4000-8000-000000000002",
        level,
      });
      expect(body.level).toBe(level);
    }
  });

  it("query params accepts optional officeId", () => {
    const q = jurisdictionQueryParams.parse({ officeId: "11111111-aaaa-4000-8000-000000000001" });
    expect(q.officeId).toBe("11111111-aaaa-4000-8000-000000000001");
    expect(q.unitId).toBeUndefined();
  });

  it("query params accepts empty (list all)", () => {
    const q = jurisdictionQueryParams.parse({});
    expect(q.officeId).toBeUndefined();
    expect(q.unitId).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GEOFENCE MODULE
// ═══════════════════════════════════════════════════════════════════════════════
describe("geofence validators", () => {
  it("accepts a valid create geofence body", () => {
    const body = createGeofenceBody.parse({
      name: "Office Zone",
      type: "office",
      centerLat: 20.2961,
      centerLng: 85.8245,
      radiusMeters: 100,
    });
    expect(body.name).toBe("Office Zone");
    expect(body.active).toBe(true); // default
  });

  it("accepts polygon with 3+ points", () => {
    const body = createGeofenceBody.parse({
      name: "Site",
      type: "site",
      centerLat: 20.0,
      centerLng: 85.0,
      radiusMeters: 500,
      polygon: [
        { lat: 20.0, lng: 85.0 },
        { lat: 20.01, lng: 85.01 },
        { lat: 20.01, lng: 85.0 },
      ],
    });
    expect(body.polygon).toHaveLength(3);
  });

  it("rejects polygon with fewer than 3 points", () => {
    expect(() => createGeofenceBody.parse({
      name: "X",
      type: "office",
      centerLat: 20.0,
      centerLng: 85.0,
      radiusMeters: 50,
      polygon: [{ lat: 20.0, lng: 85.0 }, { lat: 20.01, lng: 85.01 }],
    })).toThrow();
  });

  it("rejects latitude out of range", () => {
    expect(() => createGeofenceBody.parse({
      name: "X",
      type: "office",
      centerLat: 91,
      centerLng: 85.0,
      radiusMeters: 50,
    })).toThrow();
  });

  it("rejects longitude out of range", () => {
    expect(() => createGeofenceBody.parse({
      name: "X",
      type: "office",
      centerLat: 20.0,
      centerLng: 181,
      radiusMeters: 50,
    })).toThrow();
  });

  it("rejects non-positive radius", () => {
    expect(() => createGeofenceBody.parse({
      name: "X",
      type: "office",
      centerLat: 20.0,
      centerLng: 85.0,
      radiusMeters: 0,
    })).toThrow();
  });

  it("rejects invalid geofence type", () => {
    expect(() => createGeofenceBody.parse({
      name: "X",
      type: "invalid",
      centerLat: 20.0,
      centerLng: 85.0,
      radiusMeters: 100,
    })).toThrow();
  });

  it("validates all geofence types", () => {
    for (const t of GEOFENCE_TYPES) {
      const body = createGeofenceBody.parse({
        name: "X",
        type: t,
        centerLat: 0,
        centerLng: 0,
        radiusMeters: 10,
      });
      expect(body.type).toBe(t);
    }
  });

  it("update body allows partial fields", () => {
    const body = updateGeofenceBody.parse({ name: "Updated" });
    expect(body.name).toBe("Updated");
    expect(body.radiusMeters).toBeUndefined();
  });

  it("geofence check body validates coordinates", () => {
    const body = geofenceCheckBody.parse({ lat: 20.2961, lng: 85.8245 });
    expect(body.lat).toBe(20.2961);
    expect(body.lng).toBe(85.8245);
  });

  it("geofence check rejects invalid lat", () => {
    expect(() => geofenceCheckBody.parse({ lat: -91, lng: 0 })).toThrow();
  });

  it("geofence check rejects invalid lng", () => {
    expect(() => geofenceCheckBody.parse({ lat: 0, lng: 200 })).toThrow();
  });
});

describe("haversineDistance", () => {
  it("returns 0 for same point", () => {
    expect(haversineDistance(20.0, 85.0, 20.0, 85.0)).toBe(0);
  });

  it("calculates distance between known points", () => {
    // Bhubaneswar to Cuttack (approx 25–30 km)
    const dist = haversineDistance(20.2961, 85.8245, 20.4625, 85.8830);
    expect(dist).toBeGreaterThan(15000);
    expect(dist).toBeLessThan(30000);
  });

  it("handles antipodal points", () => {
    // North pole to south pole — ~20,000 km
    const dist = haversineDistance(90, 0, -90, 0);
    expect(dist).toBeGreaterThan(19_000_000);
    expect(dist).toBeLessThan(21_000_000);
  });
});

describe("pointInPolygon", () => {
  const square = [
    { lat: 0, lng: 0 },
    { lat: 0, lng: 10 },
    { lat: 10, lng: 10 },
    { lat: 10, lng: 0 },
  ];

  it("returns true for point inside polygon", () => {
    expect(pointInPolygon(5, 5, square)).toBe(true);
  });

  it("returns false for point outside polygon", () => {
    expect(pointInPolygon(15, 15, square)).toBe(false);
  });

  it("returns false for point clearly outside", () => {
    expect(pointInPolygon(-5, -5, square)).toBe(false);
  });

  it("handles triangle", () => {
    const triangle = [
      { lat: 0, lng: 0 },
      { lat: 10, lng: 5 },
      { lat: 0, lng: 10 },
    ];
    expect(pointInPolygon(3, 5, triangle)).toBe(true);
    expect(pointInPolygon(11, 5, triangle)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PINCODE MODULE
// ═══════════════════════════════════════════════════════════════════════════════
describe("pincode validators", () => {
  it("accepts valid 6-digit pincode", () => {
    const p = pincodeParam.parse({ code: "751001" });
    expect(p.code).toBe("751001");
  });

  it("rejects non-6-digit pincode", () => {
    expect(() => pincodeParam.parse({ code: "12345" })).toThrow();
    expect(() => pincodeParam.parse({ code: "1234567" })).toThrow();
    expect(() => pincodeParam.parse({ code: "abcdef" })).toThrow();
  });

  it("search query requires at least 1 char", () => {
    expect(() => pincodeSearchQuery.parse({ q: "" })).toThrow();
  });

  it("search query accepts valid input", () => {
    const q = pincodeSearchQuery.parse({ q: "Bhubaneswar" });
    expect(q.q).toBe("Bhubaneswar");
  });

  it("bulk import body requires at least one record", () => {
    expect(() => bulkImportBody.parse({ records: [] })).toThrow();
  });

  it("bulk import accepts valid records", () => {
    const body = bulkImportBody.parse({
      records: [
        { pincode: "751001", postOffice: "GPO Bhubaneswar", district: "Khordha", state: "Odisha" },
        { pincode: "753001", postOffice: "GPO Cuttack", district: "Cuttack", state: "Odisha", latitude: 20.46, longitude: 85.88 },
      ],
    });
    expect(body.records).toHaveLength(2);
    expect(body.records[1]!.latitude).toBe(20.46);
  });

  it("bulk import rejects invalid pincode in record", () => {
    expect(() => bulkImportBody.parse({
      records: [{ pincode: "123", postOffice: "X", district: "Y", state: "Z" }],
    })).toThrow();
  });

  it("bulk import rejects missing postOffice", () => {
    expect(() => bulkImportBody.parse({
      records: [{ pincode: "751001", postOffice: "", district: "Y", state: "Z" }],
    })).toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CONSUMER REGISTRATION
// ═══════════════════════════════════════════════════════════════════════════════
describe("consumer registration", () => {
  let queue: MemoryQueue;
  let subscribedTopics: string[];

  beforeEach(() => {
    queue = new MemoryQueue();
    subscribedTopics = [];
    const origSubscribe = queue.subscribe.bind(queue);
    queue.subscribe = <T>(topic: string, handler: unknown) => {
      subscribedTopics.push(topic);
      return origSubscribe(topic, handler as Parameters<typeof origSubscribe>[1]);
    };
  });

  it("registers hierarchy consumers without error", () => {
    expect(() => registerHierarchyConsumers(queue)).not.toThrow();
  });

  it("registers jurisdiction consumers without error", () => {
    expect(() => registerJurisdictionConsumers(queue)).not.toThrow();
  });

  it("registers geofence consumers without error", () => {
    expect(() => registerGeofenceConsumers(queue)).not.toThrow();
  });

  it("registers pincode consumers without error", () => {
    expect(() => registerPincodeConsumers(queue)).not.toThrow();
  });

  it("hierarchy consumer subscribes to expected topics", () => {
    registerHierarchyConsumers(queue);
    expect(subscribedTopics).toContain("location.hierarchy.unit.create");
    expect(subscribedTopics).toContain("location.hierarchy.unit.update");
    expect(subscribedTopics).toContain("location.hierarchy.unit.bulk_sync");
  });

  it("jurisdiction consumer subscribes to expected topics", () => {
    registerJurisdictionConsumers(queue);
    expect(subscribedTopics).toContain("location.jurisdiction.assign");
    expect(subscribedTopics).toContain("location.jurisdiction.revoke");
  });

  it("geofence consumer subscribes to expected topics", () => {
    registerGeofenceConsumers(queue);
    expect(subscribedTopics).toContain("location.geofence.create");
    expect(subscribedTopics).toContain("location.geofence.update");
    expect(subscribedTopics).toContain("location.geofence.check");
  });

  it("pincode consumer subscribes to expected topic", () => {
    registerPincodeConsumers(queue);
    expect(subscribedTopics).toContain("location.pincode.bulk_import");
  });
});

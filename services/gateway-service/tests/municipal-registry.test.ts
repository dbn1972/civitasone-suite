import { describe, it, expect } from "vitest";
import { SERVICE_ROUTES, resolveRoute } from "../src/registry.js";

const MUNICIPAL = [
  { name: "shop", port: 3060, sample: "/api/v1/shop/applications" },
  { name: "trade", port: 3070, sample: "/api/v1/trade/applications" },
  { name: "building", port: 3071, sample: "/api/v1/building/applications" },
  { name: "fire", port: 3072, sample: "/api/v1/fire/applications" },
  { name: "advertisement", port: 3073, sample: "/api/v1/advertisement/applications" },
  { name: "vendor", port: 3074, sample: "/api/v1/vendor/applications" },
  { name: "roadcut", port: 3075, sample: "/api/v1/roadcut/applications" },
  { name: "event", port: 3076, sample: "/api/v1/event/applications" },
  { name: "refund", port: 3077, sample: "/api/v1/refund/claims" },
  { name: "sewerage", port: 3078, sample: "/api/v1/sewerage/connections" },
  { name: "swm", port: 3079, sample: "/api/v1/swm/collections" },
  { name: "drainage", port: 3080, sample: "/api/v1/drainage/applications" },
  { name: "parks", port: 3081, sample: "/api/v1/parks/bookings" },
  { name: "animal", port: 3082, sample: "/api/v1/animal/registrations" },
  { name: "crematorium", port: 3083, sample: "/api/v1/crematorium/bookings" },
  { name: "parking", port: 3084, sample: "/api/v1/parking/permits" },
  { name: "market", port: 3085, sample: "/api/v1/market/allotments" },
] as const;

describe("municipal Sec5 gateway registry", () => {
  it("registers all 17 municipal services (16 Sec5 + shop reference)", () => {
    const names = new Set(SERVICE_ROUTES.map((r) => r.name));
    for (const svc of MUNICIPAL) {
      expect(names.has(svc.name)).toBe(true);
    }
  });

  it.each(MUNICIPAL)("resolves $name prefix to correct upstream port", ({ name, port, sample }) => {
    const resolved = resolveRoute(sample);
    expect(resolved?.route.name).toBe(name);
    expect(resolved?.route.upstream).toContain(`:${port}`);
  });
});

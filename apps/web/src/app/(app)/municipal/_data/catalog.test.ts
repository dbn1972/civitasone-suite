import { describe, it, expect } from "vitest";
import {
  MUNICIPAL_SERVICE_CATALOG,
  SEC5_SERVICE_COUNT,
  getMunicipalService,
  listSec5Services,
  officerApplicationsHref,
  citizenApplyHref,
} from "./catalog";

describe("municipal web catalog", () => {
  it("defines 16 Sec5 services plus shop reference", () => {
    expect(MUNICIPAL_SERVICE_CATALOG).toHaveLength(17);
    expect(SEC5_SERVICE_COUNT).toBe(16);
    expect(listSec5Services()).toHaveLength(16);
  });

  it("uses unique service keys and gateway list paths", () => {
    const keys = new Set<string>();
    const paths = new Set<string>();
    for (const svc of MUNICIPAL_SERVICE_CATALOG) {
      expect(keys.has(svc.serviceKey)).toBe(false);
      expect(paths.has(svc.listPath)).toBe(false);
      keys.add(svc.serviceKey);
      paths.add(svc.listPath);
      expect(svc.listPath.startsWith("/api/v1/")).toBe(true);
    }
  });

  it("maps trade to gateway applications path", () => {
    const trade = getMunicipalService("trade");
    expect(trade?.listPath).toBe("/api/v1/trade/applications");
    expect(officerApplicationsHref("trade")).toBe("/municipal/trade/applications");
    expect(citizenApplyHref("trade-license")).toBe("/citizen/services/trade-license/apply");
  });

  it("maps refund to requests path (not applications)", () => {
    const refund = getMunicipalService("refund");
    expect(refund?.listPath).toBe("/api/v1/refund/requests");
    expect(refund?.resourceLabel).toBe("Refund requests");
  });

  it("returns undefined for unknown service keys", () => {
    expect(getMunicipalService("unknown")).toBeUndefined();
  });
});

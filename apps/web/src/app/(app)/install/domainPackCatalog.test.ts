import { describe, it, expect } from "vitest";
import {
  DOMAIN_PACK_CATALOG,
  MUNICIPAL_DOMAIN_PACK,
  MUNICIPAL_DOMAIN_PACK_KEY,
  findCatalogEntry,
  isDomainPackStageStep,
  outcomeLabels,
} from "./domainPackCatalog";

describe("domainPackCatalog (FN-17)", () => {
  it("exposes municipal-in-v1 with TL / PGR / Water outcomes", () => {
    expect(MUNICIPAL_DOMAIN_PACK_KEY).toBe("municipal-in-v1");
    expect(MUNICIPAL_DOMAIN_PACK.outcomes.map((o) => o.packKey)).toEqual([
      "pack:trade-license",
      "pack:pgr",
      "pack:water-connection",
    ]);
    expect(outcomeLabels(MUNICIPAL_DOMAIN_PACK)).toBe("TL / PGR / Water");
    expect(DOMAIN_PACK_CATALOG.some((p) => p.domainPackKey === MUNICIPAL_DOMAIN_PACK_KEY)).toBe(true);
  });

  it("findCatalogEntry resolves municipal pack", () => {
    expect(findCatalogEntry("municipal-in-v1")?.name).toMatch(/Municipal/i);
    expect(findCatalogEntry("missing")).toBeUndefined();
  });

  it("isDomainPackStageStep detects Stage 3 / Domain Pack steps", () => {
    expect(isDomainPackStageStep({ stepNo: 3 })).toBe(true);
    expect(isDomainPackStageStep({ title: "Activate Domain Pack" })).toBe(true);
    expect(isDomainPackStageStep({ description: "activate-domain-pack handler" })).toBe(true);
    expect(isDomainPackStageStep({ stepNo: 1, title: "Choose deployment" })).toBe(false);
  });
});

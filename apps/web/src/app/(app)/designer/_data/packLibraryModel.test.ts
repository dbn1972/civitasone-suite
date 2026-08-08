import { describe, expect, it } from "vitest";
import {
  buildPackPreviewBlocks,
  filterServicePacks,
  packSourceLabel,
} from "./packLibraryModel";
import type { ServicePackDto } from "./packLibraryApi";
import type { DomainPackRow } from "./designerLoader";

const domain: DomainPackRow = {
  id: "d1",
  domainPackKey: "municipal-in-v1",
  name: "Municipal India v1",
  sector: "municipal",
  jurisdiction: "IN",
  version: 1,
  packCount: 2,
};

const pack: ServicePackDto = {
  id: "p1",
  packKey: "pack:trade-license",
  domainPackKey: "municipal-in-v1",
  name: "Trade License",
  servicePattern: "certificate",
  feeModel: "flat",
  hoaCode: "4201",
  statutoryReferences: [{ act: "Municipal Act" }],
  manifest: {
    businessService: "TL",
    blocks: {
      slaDays: 15,
      feeModel: "flat",
      feeFromMinor: 50000,
      hoaCode: "4201",
      channels: ["portal", "counter"],
      eligibilityRuleSetId: "elig-1",
      workflowDefinitionId: "wf-1",
      issuanceType: "certificate",
      requiredDocuments: [{ docType: "id_proof" }],
      forms: [
        {
          formDesign: {
            sections: [],
            fields: { a: {}, b: {} },
          },
        },
      ],
    },
  },
  version: 1,
  status: "published",
};

describe("packLibraryModel", () => {
  it("builds a B1–B8 preview walkthrough from the manifest", () => {
    const blocks = buildPackPreviewBlocks(pack);
    expect(blocks).toHaveLength(8);
    expect(blocks[1]?.summary).toMatch(/2 field/);
    expect(blocks[4]?.summary).toMatch(/₹500/);
    expect(blocks[4]?.summary).toMatch(/HOA 4201/);
  });

  it("filters by jurisdiction and source", () => {
    const tenantPack: ServicePackDto = {
      ...pack,
      id: "p2",
      packKey: "pack:local",
      domainPackKey: null,
      name: "Local copy",
    };
    const filtered = filterServicePacks([pack, tenantPack], [domain], {
      sector: "all",
      pattern: "all",
      domainFilter: "all",
      jurisdiction: "IN",
      source: "domain",
    });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.id).toBe("p1");
  });

  it("labels domain vs tenant sources", () => {
    expect(packSourceLabel(pack, domain)).toMatch(/Municipal India/);
    expect(packSourceLabel({ ...pack, domainPackKey: null }, null)).toBe("Tenant library");
  });
});

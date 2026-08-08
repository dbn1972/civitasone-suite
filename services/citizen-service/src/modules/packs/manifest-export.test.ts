import { describe, it, expect } from "vitest";
import type { ServiceDefinitionRow } from "../catalogue/schema.js";
import {
  buildExportedPackManifest,
  packKeyFromServiceKey,
  requiresStatutoryAcknowledgement,
} from "./manifest-export.js";

function sampleDef(overrides: Partial<ServiceDefinitionRow> = {}): ServiceDefinitionRow {
  return {
    id: "dddddddd-0001-4000-8000-000000000001",
    tenantId: "00000000-0000-0000-0000-000000000001",
    serviceKey: "trade-license",
    serviceId: null,
    name: "Trade License",
    ownerDepartment: "Licensing",
    servicePattern: "certificate",
    ownerOfficeId: null,
    offeringOfficeIds: null,
    workflowDefinitionId: "cccccccc-0003-4000-8000-000000000001",
    formId: "cccccccc-0001-4000-8000-000000000001",
    feeModel: "flat",
    hoaCode: "4201",
    statutoryReferences: [{ act: "Municipal Corporation Act", section: "12" }],
    version: 2,
    status: "published",
    eligibilityRuleSetId: "cccccccc-0002-4000-8000-000000000001",
    feeScheduleId: "cccccccc-0004-4000-8000-000000000001",
    issuanceType: "certificate",
    requiredDocuments: [{ docType: "id_proof", label: "ID", mandatory: true }],
    slaDays: 15,
    channels: ["portal"],
    forms: [{
      formDesign: { sections: [], fields: {} },
      runtimeMeta: { description: "TL pilot", feeFromMinor: 50000, feeCurrency: "INR" },
    }],
    outputs: [{ type: "certificate" }],
    submittedBy: null,
    publishedBy: "00000000-0000-0000-0000-000000000099",
    publishedAt: new Date("2026-08-01T00:00:00.000Z"),
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: "00000000-0000-0000-0000-000000000099",
    updatedBy: "00000000-0000-0000-0000-000000000099",
    rowVersion: 1,
    ...overrides,
  };
}

describe("packKeyFromServiceKey", () => {
  it("prefixes pack:", () => {
    expect(packKeyFromServiceKey("Trade License")).toBe("pack:trade-license");
  });

  it("keeps existing pack: prefix", () => {
    expect(packKeyFromServiceKey("pack:pgr")).toBe("pack:pgr");
  });
});

describe("buildExportedPackManifest (FN-09)", () => {
  it("snapshots B1–B8 blocks and statutory authority scope", () => {
    const manifest = buildExportedPackManifest(sampleDef());
    expect(manifest.schemaVersion).toBe("1.0");
    expect(manifest.exportedFrom.serviceKey).toBe("trade-license");
    expect(manifest.exportedFrom.definitionVersion).toBe(2);
    expect(manifest.authorityScope).toContain("Municipal Corporation Act");
    expect(manifest.blocks.formId).toBe("cccccccc-0001-4000-8000-000000000001");
    expect(manifest.blocks.feeModel).toBe("flat");
    expect(manifest.blocks.hoaCode).toBe("4201");
    expect(manifest.blocks.channels).toEqual(["portal"]);
    expect(manifest.blocks.feeFromMinor).toBe(50000);
    expect(manifest.blocks.description).toBe("TL pilot");
  });
});

describe("requiresStatutoryAcknowledgement (FN-29)", () => {
  it("requires ack when statutory act present", () => {
    expect(requiresStatutoryAcknowledgement({
      statutoryReferences: [{ act: "CRS Act" }],
      manifest: {},
    })).toBe(true);
  });

  it("requires ack when authorityScope present", () => {
    expect(requiresStatutoryAcknowledgement({
      statutoryReferences: [],
      manifest: { authorityScope: "Birth & Death — registrar" },
    })).toBe(true);
  });

  it("skips ack when neither present", () => {
    expect(requiresStatutoryAcknowledgement({
      statutoryReferences: [],
      manifest: { pilot: true },
    })).toBe(false);
  });
});

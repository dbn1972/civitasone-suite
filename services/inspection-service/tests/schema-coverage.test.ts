/**
 * Schema import verification tests.
 * Imports all Drizzle schema modules to ensure they are valid
 * and contributes to overall coverage.
 */
import { describe, it, expect } from "vitest";

describe("Schema definitions", () => {
  it("universe schema exports expected tables", async () => {
    const schema = await import("../src/modules/universe/schema.js");
    expect(schema.regulatedEntities).toBeDefined();
    expect(schema.inspectionTypes).toBeDefined();
    expect(schema.provisions).toBeDefined();
    expect(schema.vocabularies).toBeDefined();
  });

  it("risk schema exports expected tables", async () => {
    const schema = await import("../src/modules/risk/schema.js");
    expect(schema.riskModels).toBeDefined();
    expect(schema.riskScores).toBeDefined();
  });

  it("planning schema exports expected tables", async () => {
    const schema = await import("../src/modules/planning/schema.js");
    expect(schema.inspectionPlans).toBeDefined();
  });

  it("assignment schema exports expected tables", async () => {
    const schema = await import("../src/modules/assignment/schema.js");
    expect(schema.inspectionAssignments).toBeDefined();
    expect(schema.conflictDeclarations).toBeDefined();
    expect(schema.tourPlans).toBeDefined();
    expect(schema.geoAttendance).toBeDefined();
    expect(schema.inspectorCapacity).toBeDefined();
  });

  it("checklist schema exports expected tables", async () => {
    const schema = await import("../src/modules/checklist/schema.js");
    expect(schema.checklistTemplates).toBeDefined();
    expect(schema.checklistInstances).toBeDefined();
  });

  it("sync schema exports expected tables", async () => {
    const schema = await import("../src/modules/sync/schema.js");
    expect(schema.syncPackages).toBeDefined();
    expect(schema.syncUploads).toBeDefined();
    expect(schema.syncCursors).toBeDefined();
  });

  it("evidence schema exports expected tables", async () => {
    const schema = await import("../src/modules/evidence/schema.js");
    expect(schema.evidenceArtifacts).toBeDefined();
    expect(schema.chainOfCustody).toBeDefined();
    expect(schema.digitalSignatures).toBeDefined();
  });

  it("execution schema exports expected tables", async () => {
    const schema = await import("../src/modules/execution/schema.js");
    expect(schema.inspections).toBeDefined();
    expect(schema.inspectionHistory).toBeDefined();
  });

  it("findings schema exports expected tables", async () => {
    const schema = await import("../src/modules/findings/schema.js");
    expect(schema.findings).toBeDefined();
    expect(schema.complianceNotices).toBeDefined();
    expect(schema.findingSequences).toBeDefined();
  });
});

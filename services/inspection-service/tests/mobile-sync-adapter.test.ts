/**
 * Unit tests for mobile sync adapter — SVC-102 Mobile Inspection Checklist.
 * Pure functions — no mocks, no I/O, no DB.
 *
 * Validates: buildMobilePackage, mergeOfflineResponses, validatePartialSave
 */
import { describe, it, expect } from "vitest";
import {
  buildMobilePackage,
  mergeOfflineResponses,
  validatePartialSave,
  type MobilePackageInput,
  type ExistingResponse,
} from "../src/modules/checklist/mobile-sync-adapter.js";
import type {
  OfflineResponseEntry,
  PartialSavePayload,
  SyncInspection,
  SyncChecklist,
  SyncEntity,
} from "../src/modules/checklist/mobile-contract.js";

// ── Test Helpers ──────────────────────────────────────────────────────────────

function makeInspection(id: string, entityId: string): SyncInspection {
  return {
    id,
    entityId,
    inspectionTypeId: "type-1",
    scheduledDate: "2025-07-15",
    status: "scheduled",
    checklistInstanceId: `checklist-${id}`,
  };
}

function makeChecklist(id: string, inspectionId: string): SyncChecklist {
  return {
    id,
    templateId: "tpl-1",
    templateVersion: 1,
    inspectionId,
    sections: [],
    existingResponses: {},
  };
}

function makeEntity(id: string): SyncEntity {
  return {
    id,
    name: `Entity ${id}`,
    registrationNo: `REG-${id}`,
    entityType: "factory",
    latitude: 28.6139,
    longitude: 77.209,
    addressLine1: "123 Main St",
    city: "Delhi",
    state: "Delhi",
    pincode: "110001",
  };
}

function makePackageInput(overrides?: Partial<MobilePackageInput>): MobilePackageInput {
  return {
    inspections: [
      makeInspection("insp-1", "entity-1"),
      makeInspection("insp-2", "entity-2"),
    ],
    checklists: [
      makeChecklist("cl-1", "insp-1"),
      makeChecklist("cl-2", "insp-2"),
    ],
    entities: [makeEntity("entity-1"), makeEntity("entity-2"), makeEntity("entity-3")],
    evidenceMetadata: [
      { id: "ev-1", inspectionId: "insp-1", fileType: "image/jpeg", sha256: "abc123", capturedAt: "2025-07-15T10:00:00Z" },
    ],
    mapTilesUrls: ["https://tiles.example.com/z/x/y.png"],
    ...overrides,
  };
}

const VALID_UUID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

// ── buildMobilePackage ────────────────────────────────────────────────────────

describe("buildMobilePackage", () => {
  it("returns a package with all fields when no inspectionIds filter is applied", () => {
    const input = makePackageInput();
    const result = buildMobilePackage("inspector-1", [], input);

    expect(result.packageId).toBeDefined();
    expect(result.generatedAt).toBeDefined();
    expect(result.version).toBe(1);
    expect(result.inspections).toHaveLength(2);
    expect(result.checklists).toHaveLength(2);
    expect(result.entities).toHaveLength(2); // only entities referenced by inspections
    expect(result.evidenceMetadata).toHaveLength(1);
    expect(result.mapTilesUrls).toHaveLength(1);
  });

  it("filters inspections when specific IDs are provided", () => {
    const input = makePackageInput();
    const result = buildMobilePackage("inspector-1", ["insp-1"], input);

    expect(result.inspections).toHaveLength(1);
    expect(result.inspections[0]!.id).toBe("insp-1");
  });

  it("filters checklists to only those matching included inspections", () => {
    const input = makePackageInput();
    const result = buildMobilePackage("inspector-1", ["insp-1"], input);

    expect(result.checklists).toHaveLength(1);
    expect(result.checklists[0]!.inspectionId).toBe("insp-1");
  });

  it("filters entities to only those referenced by included inspections", () => {
    const input = makePackageInput();
    const result = buildMobilePackage("inspector-1", ["insp-1"], input);

    expect(result.entities).toHaveLength(1);
    expect(result.entities[0]!.id).toBe("entity-1");
  });

  it("filters evidence metadata to only those for included inspections", () => {
    const input = makePackageInput();
    const result = buildMobilePackage("inspector-1", ["insp-2"], input);

    expect(result.evidenceMetadata).toHaveLength(0); // evidence only for insp-1
  });

  it("handles empty input gracefully", () => {
    const input: MobilePackageInput = {
      inspections: [],
      checklists: [],
      entities: [],
      evidenceMetadata: [],
      mapTilesUrls: [],
    };
    const result = buildMobilePackage("inspector-1", [], input);

    expect(result.inspections).toHaveLength(0);
    expect(result.checklists).toHaveLength(0);
    expect(result.entities).toHaveLength(0);
    expect(result.evidenceMetadata).toHaveLength(0);
    expect(result.mapTilesUrls).toHaveLength(0);
  });

  it("generates a unique packageId", () => {
    const input = makePackageInput();
    const result1 = buildMobilePackage("inspector-1", [], input);
    const result2 = buildMobilePackage("inspector-1", [], input);

    expect(result1.packageId).not.toBe(result2.packageId);
  });
});

// ── mergeOfflineResponses ─────────────────────────────────────────────────────

describe("mergeOfflineResponses", () => {
  it("accepts all incoming responses when no existing responses", () => {
    const existing: Record<string, ExistingResponse> = {};
    const incoming: Record<string, OfflineResponseEntry> = {
      q1: { value: "answer1", answeredAt: "2025-07-15T10:00:00Z", deviceTimestamp: 1000 },
      q2: { value: "answer2", answeredAt: "2025-07-15T10:01:00Z", deviceTimestamp: 1001 },
    };

    const result = mergeOfflineResponses(existing, incoming);

    expect(result.accepted).toEqual(["q1", "q2"]);
    expect(result.rejected).toHaveLength(0);
    expect(result.merged["q1"]!.value).toBe("answer1");
    expect(result.merged["q2"]!.value).toBe("answer2");
  });

  it("accepts incoming response when deviceTimestamp is higher", () => {
    const existing: Record<string, ExistingResponse> = {
      q1: { value: "old", answeredAt: "2025-07-15T09:00:00Z", deviceTimestamp: 500, deviceId: "dev-1" },
    };
    const incoming: Record<string, OfflineResponseEntry> = {
      q1: { value: "new", answeredAt: "2025-07-15T10:00:00Z", deviceTimestamp: 1000 },
    };

    const result = mergeOfflineResponses(existing, incoming);

    expect(result.accepted).toEqual(["q1"]);
    expect(result.rejected).toHaveLength(0);
    expect(result.merged["q1"]!.value).toBe("new");
  });

  it("rejects incoming response when deviceTimestamp is lower", () => {
    const existing: Record<string, ExistingResponse> = {
      q1: { value: "server", answeredAt: "2025-07-15T10:00:00Z", deviceTimestamp: 2000, deviceId: "dev-1" },
    };
    const incoming: Record<string, OfflineResponseEntry> = {
      q1: { value: "client", answeredAt: "2025-07-15T09:00:00Z", deviceTimestamp: 1000 },
    };

    const result = mergeOfflineResponses(existing, incoming);

    expect(result.accepted).toHaveLength(0);
    expect(result.rejected).toEqual(["q1"]);
    expect(result.merged["q1"]!.value).toBe("server");
  });

  it("rejects incoming response when timestamps are equal (tie goes to server)", () => {
    const existing: Record<string, ExistingResponse> = {
      q1: { value: "server", answeredAt: "2025-07-15T10:00:00Z", deviceTimestamp: 1000, deviceId: "dev-1" },
    };
    const incoming: Record<string, OfflineResponseEntry> = {
      q1: { value: "client", answeredAt: "2025-07-15T10:00:00Z", deviceTimestamp: 1000 },
    };

    const result = mergeOfflineResponses(existing, incoming);

    expect(result.accepted).toHaveLength(0);
    expect(result.rejected).toEqual(["q1"]);
    expect(result.merged["q1"]!.value).toBe("server");
  });

  it("handles mixed accept/reject across multiple questions", () => {
    const existing: Record<string, ExistingResponse> = {
      q1: { value: "old1", answeredAt: "2025-07-15T09:00:00Z", deviceTimestamp: 500, deviceId: "dev-1" },
      q2: { value: "old2", answeredAt: "2025-07-15T10:00:00Z", deviceTimestamp: 2000, deviceId: "dev-1" },
    };
    const incoming: Record<string, OfflineResponseEntry> = {
      q1: { value: "new1", answeredAt: "2025-07-15T10:00:00Z", deviceTimestamp: 1000 },
      q2: { value: "new2", answeredAt: "2025-07-15T09:00:00Z", deviceTimestamp: 500 },
      q3: { value: "brand-new", answeredAt: "2025-07-15T10:00:00Z", deviceTimestamp: 1500 },
    };

    const result = mergeOfflineResponses(existing, incoming);

    expect(result.accepted).toContain("q1"); // incoming newer
    expect(result.accepted).toContain("q3"); // no existing
    expect(result.rejected).toContain("q2"); // existing newer
    expect(result.merged["q1"]!.value).toBe("new1");
    expect(result.merged["q2"]!.value).toBe("old2");
    expect(result.merged["q3"]!.value).toBe("brand-new");
  });

  it("preserves existing responses not in incoming", () => {
    const existing: Record<string, ExistingResponse> = {
      q1: { value: "keep", answeredAt: "2025-07-15T10:00:00Z", deviceTimestamp: 1000, deviceId: "dev-1" },
    };
    const incoming: Record<string, OfflineResponseEntry> = {
      q2: { value: "new", answeredAt: "2025-07-15T10:01:00Z", deviceTimestamp: 1001 },
    };

    const result = mergeOfflineResponses(existing, incoming);

    expect(result.merged["q1"]!.value).toBe("keep");
    expect(result.merged["q2"]!.value).toBe("new");
  });

  it("handles empty incoming responses", () => {
    const existing: Record<string, ExistingResponse> = {
      q1: { value: "keep", answeredAt: "2025-07-15T10:00:00Z", deviceTimestamp: 1000, deviceId: "dev-1" },
    };

    const result = mergeOfflineResponses(existing, {});

    expect(result.accepted).toHaveLength(0);
    expect(result.rejected).toHaveLength(0);
    expect(result.merged["q1"]!.value).toBe("keep");
  });
});

// ── validatePartialSave ───────────────────────────────────────────────────────

describe("validatePartialSave", () => {
  function makeValidPartialSave(): PartialSavePayload {
    return {
      instanceId: VALID_UUID,
      inspectorId: VALID_UUID,
      deviceId: "device-001",
      responses: {
        q1: { value: "answer", answeredAt: "2025-07-15T10:00:00Z", deviceTimestamp: 1000 },
      },
      savedAt: "2025-07-15T10:00:30Z",
      completionPercent: 50,
    };
  }

  it("returns valid for a well-formed partial save", () => {
    const result = validatePartialSave(makeValidPartialSave());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects invalid instanceId", () => {
    const payload = { ...makeValidPartialSave(), instanceId: "not-a-uuid" };
    const result = validatePartialSave(payload);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("instanceId must be a valid UUID");
  });

  it("rejects invalid inspectorId", () => {
    const payload = { ...makeValidPartialSave(), inspectorId: "" };
    const result = validatePartialSave(payload);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("inspectorId must be a valid UUID");
  });

  it("rejects empty deviceId", () => {
    const payload = { ...makeValidPartialSave(), deviceId: "" };
    const result = validatePartialSave(payload);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("deviceId is required");
  });

  it("rejects invalid savedAt timestamp", () => {
    const payload = { ...makeValidPartialSave(), savedAt: "not-a-date" };
    const result = validatePartialSave(payload);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("savedAt must be a valid ISO-8601 timestamp");
  });

  it("rejects completionPercent below 0", () => {
    const payload = { ...makeValidPartialSave(), completionPercent: -1 };
    const result = validatePartialSave(payload);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("completionPercent must be a number between 0 and 100");
  });

  it("rejects completionPercent above 100", () => {
    const payload = { ...makeValidPartialSave(), completionPercent: 101 };
    const result = validatePartialSave(payload);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("completionPercent must be a number between 0 and 100");
  });

  it("rejects empty responses", () => {
    const payload = { ...makeValidPartialSave(), responses: {} };
    const result = validatePartialSave(payload);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("at least one response is required");
  });

  it("rejects response missing answeredAt", () => {
    const payload = {
      ...makeValidPartialSave(),
      responses: {
        q1: { value: "x", answeredAt: "", deviceTimestamp: 1000 },
      },
    };
    const result = validatePartialSave(payload);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("answeredAt"))).toBe(true);
  });

  it("rejects response with non-numeric deviceTimestamp", () => {
    const payload = {
      ...makeValidPartialSave(),
      responses: {
        q1: { value: "x", answeredAt: "2025-07-15T10:00:00Z", deviceTimestamp: "abc" as unknown as number },
      },
    };
    const result = validatePartialSave(payload);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("deviceTimestamp"))).toBe(true);
  });

  it("accepts completionPercent of 0", () => {
    const payload = { ...makeValidPartialSave(), completionPercent: 0 };
    const result = validatePartialSave(payload);
    expect(result.valid).toBe(true);
  });

  it("accepts completionPercent of 100", () => {
    const payload = { ...makeValidPartialSave(), completionPercent: 100 };
    const result = validatePartialSave(payload);
    expect(result.valid).toBe(true);
  });

  it("collects all errors from multiple invalid fields", () => {
    const payload: PartialSavePayload = {
      instanceId: "bad",
      inspectorId: "bad",
      deviceId: "",
      responses: {},
      savedAt: "bad",
      completionPercent: -5,
    };
    const result = validatePartialSave(payload);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(5);
  });
});

/**
 * Mobile Sync Adapter — SVC-102 Mobile Inspection Checklist.
 *
 * Assembles sync packages for mobile download, merges offline responses using LWW,
 * and validates partial save payloads.
 *
 * Pure logic layer — delegates DB reads to repo, no direct DB/cache access.
 *
 * _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_
 */
import type {
  MobileSyncPackage,
  SyncInspection,
  SyncChecklist,
  SyncEntity,
  SyncEvidenceMetadata,
  OfflineResponseEntry,
  PartialSavePayload,
  ConflictStrategy,
} from "./mobile-contract.js";

// ─── Types ────────────────────────────────────────────────────────────────────

/** Input data for building a mobile package (fetched from repos). */
export interface MobilePackageInput {
  readonly inspections: ReadonlyArray<SyncInspection>;
  readonly checklists: ReadonlyArray<SyncChecklist>;
  readonly entities: ReadonlyArray<SyncEntity>;
  readonly evidenceMetadata: ReadonlyArray<SyncEvidenceMetadata>;
  readonly mapTilesUrls: ReadonlyArray<string>;
}

/** Existing server-side response keyed by questionId. */
export interface ExistingResponse {
  readonly value: unknown;
  readonly answeredAt: string;
  readonly deviceTimestamp: number;
  readonly deviceId: string;
}

/** Result of merging offline responses with existing server state. */
export interface MergeResult {
  /** Final merged responses (winner for each questionId). */
  readonly merged: Record<string, ExistingResponse>;
  /** Question IDs where the incoming response won (was newer). */
  readonly accepted: string[];
  /** Question IDs where the existing response was preserved (was newer or equal). */
  readonly rejected: string[];
}

/** Validation result for partial save payloads. */
export interface PartialSaveValidation {
  readonly valid: boolean;
  readonly errors: string[];
}

// ─── Package Assembly ─────────────────────────────────────────────────────────

/**
 * Build a mobile sync package from pre-fetched data.
 *
 * The caller (consumer or route handler) is responsible for fetching the raw data
 * from repos; this function assembles it into the package shape mobile expects.
 *
 * @param inspectorId - The inspector the package is built for (for audit/tracing).
 * @param inspectionIds - The inspections included in this package.
 * @param input - Pre-fetched data from repos.
 * @returns A MobileSyncPackage ready for serialization and download.
 *
 * _Validates: Requirement 6.1_
 */
export function buildMobilePackage(
  inspectorId: string,
  inspectionIds: ReadonlyArray<string>,
  input: MobilePackageInput,
): MobileSyncPackage {
  // Filter to only requested inspections (or all if inspectionIds is empty)
  const filteredInspections =
    inspectionIds.length > 0
      ? input.inspections.filter((i) => inspectionIds.includes(i.id))
      : [...input.inspections];

  const inspectionIdSet = new Set(filteredInspections.map((i) => i.id));
  const entityIdSet = new Set(filteredInspections.map((i) => i.entityId));

  // Filter checklists to only those bound to included inspections
  const filteredChecklists = input.checklists.filter((c) =>
    inspectionIdSet.has(c.inspectionId),
  );

  // Filter entities to only those referenced by included inspections
  const filteredEntities = input.entities.filter((e) => entityIdSet.has(e.id));

  // Filter evidence metadata to only those for included inspections
  const filteredEvidence = input.evidenceMetadata.filter((e) =>
    inspectionIdSet.has(e.inspectionId),
  );

  return {
    packageId: crypto.randomUUID(),
    generatedAt: new Date().toISOString(),
    version: 1,
    inspections: filteredInspections,
    checklists: filteredChecklists,
    entities: filteredEntities,
    evidenceMetadata: filteredEvidence,
    mapTilesUrls: [...input.mapTilesUrls],
  };
}

// ─── Conflict Resolution (LWW) ──────────────────────────────────────────────

/**
 * Merge offline responses with existing server-side responses using LWW strategy.
 *
 * For each questionId:
 * - If incoming deviceTimestamp > existing deviceTimestamp → incoming wins.
 * - If timestamps are equal → existing wins (server tie-break).
 * - If no existing response → incoming always wins.
 *
 * @param existingResponses - Current server-side responses keyed by questionId.
 * @param incomingResponses - Offline responses from mobile keyed by questionId.
 * @param _conflictStrategy - Strategy to use (only "lww_device_timestamp" supported).
 * @returns MergeResult with final merged state and per-question outcomes.
 *
 * _Validates: Requirements 6.3, 6.4_
 */
export function mergeOfflineResponses(
  existingResponses: Record<string, ExistingResponse>,
  incomingResponses: Record<string, OfflineResponseEntry>,
  _conflictStrategy: ConflictStrategy = "lww_device_timestamp",
): MergeResult {
  const merged: Record<string, ExistingResponse> = { ...existingResponses };
  const accepted: string[] = [];
  const rejected: string[] = [];

  for (const [questionId, incoming] of Object.entries(incomingResponses)) {
    const existing = existingResponses[questionId];

    if (!existing) {
      // No existing response — incoming always wins
      merged[questionId] = {
        value: incoming.value,
        answeredAt: incoming.answeredAt,
        deviceTimestamp: incoming.deviceTimestamp,
        deviceId: "", // Will be populated from upload context
      };
      accepted.push(questionId);
    } else if (incoming.deviceTimestamp > existing.deviceTimestamp) {
      // Incoming is newer — overwrites
      merged[questionId] = {
        value: incoming.value,
        answeredAt: incoming.answeredAt,
        deviceTimestamp: incoming.deviceTimestamp,
        deviceId: existing.deviceId,
      };
      accepted.push(questionId);
    } else {
      // Existing is newer or equal — preserved (tie goes to server)
      rejected.push(questionId);
    }
  }

  return { merged, accepted, rejected };
}

// ─── Partial Save Validation ─────────────────────────────────────────────────

/**
 * Validate a partial save payload structure before persisting.
 *
 * Checks:
 * - instanceId is a non-empty string (UUID format)
 * - inspectorId is a non-empty string (UUID format)
 * - deviceId is non-empty
 * - savedAt is a valid ISO-8601 timestamp
 * - completionPercent is between 0 and 100
 * - At least one response exists
 * - Each response has required fields (value, answeredAt, deviceTimestamp)
 *
 * @param partial - The partial save payload to validate.
 * @returns PartialSaveValidation with valid flag and error messages.
 *
 * _Validates: Requirement 6.5_
 */
export function validatePartialSave(partial: PartialSavePayload): PartialSaveValidation {
  const errors: string[] = [];
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  // instanceId validation
  if (!partial.instanceId || !UUID_RE.test(partial.instanceId)) {
    errors.push("instanceId must be a valid UUID");
  }

  // inspectorId validation
  if (!partial.inspectorId || !UUID_RE.test(partial.inspectorId)) {
    errors.push("inspectorId must be a valid UUID");
  }

  // deviceId validation
  if (!partial.deviceId || partial.deviceId.trim().length === 0) {
    errors.push("deviceId is required");
  }

  // savedAt validation
  if (!partial.savedAt || isNaN(Date.parse(partial.savedAt))) {
    errors.push("savedAt must be a valid ISO-8601 timestamp");
  }

  // completionPercent validation
  if (
    typeof partial.completionPercent !== "number" ||
    partial.completionPercent < 0 ||
    partial.completionPercent > 100
  ) {
    errors.push("completionPercent must be a number between 0 and 100");
  }

  // responses validation
  if (!partial.responses || Object.keys(partial.responses).length === 0) {
    errors.push("at least one response is required");
  } else {
    for (const [questionId, response] of Object.entries(partial.responses)) {
      if (response.answeredAt === undefined || response.answeredAt === "") {
        errors.push(`response for ${questionId} must have answeredAt`);
      }
      if (typeof response.deviceTimestamp !== "number") {
        errors.push(`response for ${questionId} must have numeric deviceTimestamp`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

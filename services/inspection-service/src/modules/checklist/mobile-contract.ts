/**
 * Mobile API Contract — SVC-102 Mobile Inspection Checklist.
 *
 * Documents the sync/checklist flow contract between the inspection-service backend
 * and the Flutter mobile app. This is the authoritative reference for mobile developers.
 *
 * Key concepts:
 * - Offline-first: mobile downloads a sync package, fills checklists offline, uploads when online
 * - Conflict resolution: Last-Writer-Wins (LWW) using device-provided timestamps
 * - Evidence: GPS-tagged photos with SHA-256 integrity hashes, chunked upload for large files
 * - Partial saves: auto-save every 30s to prevent data loss
 *
 * _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8_
 */

// ─── Sync Package (Download) ─────────────────────────────────────────────────

/**
 * Shape of the mobile sync package — everything the inspector needs to work offline.
 * Requested via POST /v1/inspection/sync/packages, downloaded as compressed JSON bundle.
 */
export interface MobileSyncPackage {
  /** Unique package ID — used to track sync cursor. */
  readonly packageId: string;
  /** ISO-8601 generation timestamp. */
  readonly generatedAt: string;
  /** Package version for forward-compatibility. */
  readonly version: number;

  /** Inspections assigned to this inspector for the current period. */
  readonly inspections: ReadonlyArray<SyncInspection>;
  /** Checklist instances (deep-copied templates bound to inspections). */
  readonly checklists: ReadonlyArray<SyncChecklist>;
  /** Entities (establishments) to be inspected — includes geo coordinates for routing. */
  readonly entities: ReadonlyArray<SyncEntity>;
  /** Evidence metadata already captured (for resuming incomplete inspections). */
  readonly evidenceMetadata: ReadonlyArray<SyncEvidenceMetadata>;
  /** URLs for offline map tiles (optional, based on includeMapTiles flag). */
  readonly mapTilesUrls: ReadonlyArray<string>;
}

export interface SyncInspection {
  readonly id: string;
  readonly entityId: string;
  readonly inspectionTypeId: string;
  readonly scheduledDate: string;
  readonly status: string;
  readonly checklistInstanceId: string;
}

export interface SyncChecklist {
  readonly id: string;
  readonly templateId: string;
  readonly templateVersion: number;
  readonly inspectionId: string;
  readonly sections: ReadonlyArray<SyncChecklistSection>;
  /** Previously submitted responses (for resuming). */
  readonly existingResponses: Record<string, SyncResponseValue>;
}

export interface SyncChecklistSection {
  readonly id: string;
  readonly title: string;
  readonly sortOrder: number;
  readonly weight: number;
  readonly prerequisite?: { sectionId: string; minScore: number };
  readonly questions: ReadonlyArray<SyncChecklistQuestion>;
}

export interface SyncChecklistQuestion {
  readonly id: string;
  readonly text: string;
  readonly fieldType: string;
  readonly sortOrder: number;
  readonly weight: number;
  readonly required: boolean;
  readonly validationRules?: object;
  readonly helpText?: string;
  readonly conditionalLogic?: ReadonlyArray<SyncConditionalRule>;
}

export interface SyncConditionalRule {
  readonly dependsOn: string;
  readonly operator: "eq" | "neq" | "gt" | "lt";
  readonly value: unknown;
  readonly action: "show" | "hide";
}

export interface SyncResponseValue {
  readonly value: unknown;
  readonly answeredAt: string;
  readonly deviceId: string;
}

export interface SyncEntity {
  readonly id: string;
  readonly name: string;
  readonly registrationNo: string;
  readonly entityType: string;
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly addressLine1: string;
  readonly city: string;
  readonly state: string;
  readonly pincode: string;
}

export interface SyncEvidenceMetadata {
  readonly id: string;
  readonly inspectionId: string;
  readonly fileType: string;
  readonly sha256: string;
  readonly capturedAt: string;
}

// ─── Offline Response (Upload) ───────────────────────────────────────────────

/**
 * Shape of the offline response payload — what mobile sends back when syncing.
 * Submitted via POST /v1/inspection/sync/upload.
 */
export interface MobileOfflineResponse {
  /** Inspector who captured the data. */
  readonly inspectorId: string;
  /** Inspection this data belongs to. */
  readonly inspectionId: string;
  /** Device identifier for conflict resolution and audit. */
  readonly deviceId: string;
  /** Monotonic sequence number per device — used for ordering and idempotency. */
  readonly sequenceNumber: number;
  /** Checklist responses captured offline. */
  readonly responses: Record<string, OfflineResponseEntry>;
  /** Evidence files captured (metadata only — actual files uploaded separately via chunked upload). */
  readonly evidence: ReadonlyArray<OfflineEvidenceEntry>;
  /** SHA-256 hash of the entire payload for integrity verification. */
  readonly sha256Hash: string;
  /** Network state at time of upload (online = immediate, offline = queued on device). */
  readonly networkState: "online" | "offline";
}

export interface OfflineResponseEntry {
  /** The response value (type depends on fieldType). */
  readonly value: unknown;
  /** ISO-8601 timestamp when the response was captured on device. */
  readonly answeredAt: string;
  /** Device-local timestamp for LWW conflict resolution. */
  readonly deviceTimestamp: number;
  /** GPS latitude at time of capture (auto-captured, not user-typed). */
  readonly gpsLatitude?: number;
  /** GPS longitude at time of capture (auto-captured, not user-typed). */
  readonly gpsLongitude?: number;
}

export interface OfflineEvidenceEntry {
  /** Client-generated UUID for the evidence item. */
  readonly evidenceId: string;
  /** SHA-256 hash of the file content (computed on device at capture time). */
  readonly sha256: string;
  /** MIME type of the evidence file. */
  readonly mimeType: string;
  /** File size in bytes — used for chunked upload planning. */
  readonly fileSizeBytes: number;
  /** GPS latitude at capture. */
  readonly gpsLatitude?: number;
  /** GPS longitude at capture. */
  readonly gpsLongitude?: number;
  /** ISO-8601 timestamp when evidence was captured. */
  readonly capturedAt: string;
}

// ─── Partial Save ────────────────────────────────────────────────────────────

/**
 * Partial checklist response — auto-saved every 30s from mobile.
 * Submitted via POST /v1/inspection/sync/responses/partial.
 * On server: upserts partial progress; does NOT trigger scoring or completion checks.
 */
export interface PartialSavePayload {
  /** Checklist instance ID. */
  readonly instanceId: string;
  /** Inspector performing the checklist. */
  readonly inspectorId: string;
  /** Device identifier. */
  readonly deviceId: string;
  /** Partial responses captured so far. */
  readonly responses: Record<string, OfflineResponseEntry>;
  /** ISO-8601 timestamp of this partial save. */
  readonly savedAt: string;
  /** Percentage completion (client-computed, for display only). */
  readonly completionPercent: number;
}

// ─── Conflict Resolution Strategy ───────────────────────────────────────────

/**
 * Conflict resolution: Last-Writer-Wins (LWW) using deviceTimestamp.
 *
 * When merging offline responses with server state:
 * 1. For each questionId, compare deviceTimestamp of incoming vs existing response.
 * 2. The response with the HIGHER deviceTimestamp wins (more recent write).
 * 3. If timestamps are equal, the server-side value is preserved (tie goes to server).
 * 4. Conflict resolution is per-question, not per-checklist — partial overwrites are fine.
 *
 * This strategy is appropriate because:
 * - Inspections are single-inspector (no concurrent writers in normal flow).
 * - Conflicts only arise from retry/reconnect scenarios on the same device.
 * - Device clock skew is acceptable because same device = same clock.
 */
export type ConflictStrategy = "lww_device_timestamp";

export const DEFAULT_CONFLICT_STRATEGY: ConflictStrategy = "lww_device_timestamp";

// ─── Chunked Upload ─────────────────────────────────────────────────────────

/**
 * Chunked upload for large evidence files (photos, videos).
 * Used via POST /v1/inspection/sync/upload/chunked.
 *
 * Flow:
 * 1. Client sends first chunk with total file metadata (size, sha256, mimeType).
 * 2. Server returns a progressToken (UUID).
 * 3. Client sends subsequent chunks referencing the progressToken.
 * 4. When all chunks received, server verifies SHA-256 integrity.
 * 5. If hash matches, evidence is registered. If not, 422 returned.
 *
 * Resilience: if upload is interrupted, client can resume from the last acknowledged chunk.
 */
export interface ChunkedUploadInitPayload {
  /** Client-generated evidence ID. */
  readonly evidenceId: string;
  /** Inspection this evidence belongs to. */
  readonly inspectionId: string;
  /** Total file size in bytes. */
  readonly totalSizeBytes: number;
  /** Expected SHA-256 of the complete file. */
  readonly sha256: string;
  /** MIME type. */
  readonly mimeType: string;
  /** Chunk size in bytes (recommended: 1MB). */
  readonly chunkSizeBytes: number;
  /** Total number of chunks. */
  readonly totalChunks: number;
  /** GPS coordinates at capture. */
  readonly gpsLatitude?: number;
  readonly gpsLongitude?: number;
  /** Capture timestamp. */
  readonly capturedAt: string;
  /** Device identifier. */
  readonly deviceId: string;
}

export interface ChunkedUploadResponse {
  /** Token to reference this upload session. */
  readonly progressToken: string;
  /** Number of chunks received so far. */
  readonly chunksReceived: number;
  /** Total chunks expected. */
  readonly totalChunks: number;
  /** Whether the upload is complete. */
  readonly complete: boolean;
}

// ─── Package Manifest ────────────────────────────────────────────────────────

/**
 * Lightweight manifest returned by GET /v1/inspection/sync/packages/:id/manifest.
 * Allows mobile to check what's in a package before downloading the full bundle.
 * Useful for bandwidth-constrained environments (rural inspection sites).
 */
export interface PackageManifest {
  readonly packageId: string;
  readonly generatedAt: string;
  readonly totalSizeBytes: number;
  readonly items: ReadonlyArray<ManifestItem>;
}

export interface ManifestItem {
  readonly type: "inspection" | "checklist" | "entity" | "evidence_metadata" | "map_tile";
  readonly id: string;
  readonly sizeBytes: number;
}

// ─── Required Mobile Capabilities ───────────────────────────────────────────

/**
 * Capabilities the mobile app MUST support for the inspection checklist flow.
 * Used during app initialization to verify device readiness.
 */
export const REQUIRED_CAPABILITIES = [
  /** GPS capture for geo-tagging responses and evidence. */
  "gps_capture",
  /** Camera access for evidence photo/video capture. */
  "camera",
  /** Offline storage (Hive/SQLite) for sync packages and queued uploads. */
  "offline_storage",
  /** Background sync for uploading evidence when connectivity is restored. */
  "background_sync",
  /** SHA-256 computation for evidence integrity verification. */
  "sha256_compute",
] as const;

export type MobileCapability = typeof REQUIRED_CAPABILITIES[number];

// ─── Namespace Export ────────────────────────────────────────────────────────

/**
 * MobileChecklistContract — aggregated namespace documenting the mobile API contract.
 */
// eslint-disable-next-line @typescript-eslint/no-namespace -- type-only aggregation namespace documenting the mobile API contract
export namespace MobileChecklistContract {
  export type SyncPackage = MobileSyncPackage;
  export type OfflineResponse = MobileOfflineResponse;
  export type PartialSave = PartialSavePayload;
  export type ChunkedUpload = ChunkedUploadInitPayload;
  export type ChunkedUploadResult = ChunkedUploadResponse;
  export type Manifest = PackageManifest;
  export type Capability = MobileCapability;
  export type Conflict = ConflictStrategy;

  /** Default conflict resolution strategy. */
  export const conflictStrategy = DEFAULT_CONFLICT_STRATEGY;
  /** Required device capabilities. */
  export const capabilities = REQUIRED_CAPABILITIES;
}

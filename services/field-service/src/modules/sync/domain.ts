/**
 * sync/domain.ts — Offline sync conflict resolution and queue processing.
 * Strategies: server-wins, client-wins, merge (field-level).
 */

export type ConflictStrategy = "server_wins" | "client_wins" | "merge";

export interface SyncOperation {
  id: string;
  entityType: string;
  entityId: string;
  operation: "create" | "update" | "delete";
  payload: Record<string, unknown>;
  clientTimestamp: string;
  clientVersion: number;
}

export interface ServerEntity {
  version: number;
  updatedAt: string;
  data: Record<string, unknown>;
}

export interface ConflictResult {
  resolved: boolean;
  winner: "server" | "client" | "merged";
  finalData: Record<string, unknown>;
  conflictDetails?: string | undefined;
}

/**
 * Compare versions to detect conflict.
 * Conflict exists if client's base version is behind server's current version.
 */
export function hasConflict(clientVersion: number, serverVersion: number): boolean {
  return clientVersion < serverVersion;
}

/**
 * Resolve a conflict between client and server data.
 */
export function resolveConflict(
  strategy: ConflictStrategy,
  clientData: Record<string, unknown>,
  serverEntity: ServerEntity,
  clientVersion: number,
): ConflictResult {
  // No conflict — client is up to date
  if (!hasConflict(clientVersion, serverEntity.version)) {
    return { resolved: true, winner: "client", finalData: clientData };
  }

  switch (strategy) {
    case "server_wins":
      return {
        resolved: true,
        winner: "server",
        finalData: serverEntity.data,
        conflictDetails: `server version ${serverEntity.version} wins over client version ${clientVersion}`,
      };

    case "client_wins":
      return {
        resolved: true,
        winner: "client",
        finalData: clientData,
        conflictDetails: `client data applied over server version ${serverEntity.version}`,
      };

    case "merge":
      return mergeFields(clientData, serverEntity);
  }
}

/**
 * Field-level merge: take newer values for each field.
 * Server fields that client didn't modify are preserved.
 * Client fields that differ from server are applied.
 */
function mergeFields(clientData: Record<string, unknown>, serverEntity: ServerEntity): ConflictResult {
  const merged: Record<string, unknown> = { ...serverEntity.data };
  const conflicts: string[] = [];

  for (const key of Object.keys(clientData)) {
    if (clientData[key] !== serverEntity.data[key]) {
      // Client changed this field — apply it
      merged[key] = clientData[key];
      conflicts.push(key);
    }
  }

  return {
    resolved: true,
    winner: "merged",
    finalData: merged,
    conflictDetails: conflicts.length > 0 ? `merged fields: ${conflicts.join(", ")}` : undefined,
  };
}

export interface QueueItem {
  id: string;
  operation: SyncOperation;
  attempts: number;
  lastError?: string;
}

export interface ProcessResult {
  processed: number;
  failed: number;
  conflicts: number;
  results: Array<{
    operationId: string;
    status: "applied" | "conflict_resolved" | "failed";
    details?: string;
  }>;
}

/**
 * Validate a sync batch before processing.
 * - Operations must have valid entity types
 * - Timestamps must be parseable
 * - No duplicate operation IDs in the batch
 */
export function validateSyncBatch(operations: SyncOperation[]): string | null {
  const validEntityTypes = ["task", "visit", "route"];
  const validOps = ["create", "update", "delete"];
  const ids = new Set<string>();

  for (const op of operations) {
    if (!validEntityTypes.includes(op.entityType)) {
      return `invalid entity type: ${op.entityType}`;
    }
    if (!validOps.includes(op.operation)) {
      return `invalid operation: ${op.operation}`;
    }
    if (isNaN(new Date(op.clientTimestamp).getTime())) {
      return `invalid timestamp for operation ${op.id}`;
    }
    if (ids.has(op.id)) {
      return `duplicate operation id: ${op.id}`;
    }
    ids.add(op.id);
  }

  return null;
}

/**
 * Determine conflict strategy based on entity type and operation.
 * - Deletes always use server_wins (safety)
 * - Creates always use client_wins (no server state)
 * - Updates use merge by default
 */
export function determineStrategy(operation: "create" | "update" | "delete"): ConflictStrategy {
  switch (operation) {
    case "create":
      return "client_wins";
    case "delete":
      return "server_wins";
    case "update":
      return "merge";
  }
}

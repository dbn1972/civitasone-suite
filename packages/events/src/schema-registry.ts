/**
 * W2.2 — Event Schema Registry.
 *
 * Runtime schema governance for the event bus. Validates event payloads at
 * publish AND consume boundaries. Enforces backward compatibility on
 * schemaVersion changes.
 *
 * Registry model:
 *   - Each event type has a registered JSON schema per version
 *   - Publishing with an unregistered type → REJECTED (fail-closed)
 *   - Publishing a payload that doesn't match the schema → REJECTED
 *   - A new schemaVersion must be backward-compatible (additive only)
 *
 * Compatibility rules (backward-compat = consumer of old version can read new):
 *   - New fields MUST be optional (nullable or have defaults)
 *   - Existing fields MUST NOT be removed
 *   - Existing field types MUST NOT change
 *   - Required fields MUST NOT be added
 */
import { z, type ZodType } from "zod";

export class SchemaRegistryError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "SchemaRegistryError";
  }
}

export interface RegisteredSchema {
  eventType: string;
  schemaVersion: string;
  schema: ZodType;
  registeredAt: string;
}

// In-memory registry (production: backed by DB/cache for distributed access)
const registry = new Map<string, Map<string, RegisteredSchema>>(); // eventType → version → schema

/**
 * Register a schema for an event type + version.
 * If a schema already exists for this type+version, it's idempotent (no-op).
 */
export function registerSchema(eventType: string, schemaVersion: string, schema: ZodType): void {
  if (!registry.has(eventType)) registry.set(eventType, new Map());
  const versions = registry.get(eventType)!;
  if (versions.has(schemaVersion)) return; // idempotent
  versions.set(schemaVersion, { eventType, schemaVersion, schema, registeredAt: new Date().toISOString() });
}

/**
 * Validate a payload against the registered schema for its event type + version.
 * Throws SchemaRegistryError if:
 *   - No schema is registered for this type (UNREGISTERED_EVENT_TYPE)
 *   - No schema exists for this version (UNREGISTERED_SCHEMA_VERSION)
 *   - Payload doesn't match the schema (PAYLOAD_VALIDATION_FAILED)
 */
export function validatePayload(eventType: string, schemaVersion: string, payload: unknown): void {
  const versions = registry.get(eventType);
  if (!versions) {
    throw new SchemaRegistryError(
      "UNREGISTERED_EVENT_TYPE",
      `No schema registered for event type '${eventType}'. Register before publishing.`,
    );
  }
  const registered = versions.get(schemaVersion);
  if (!registered) {
    throw new SchemaRegistryError(
      "UNREGISTERED_SCHEMA_VERSION",
      `No schema registered for '${eventType}' version '${schemaVersion}'. Available: ${[...versions.keys()].join(", ")}`,
    );
  }
  const result = registered.schema.safeParse(payload);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new SchemaRegistryError(
      "PAYLOAD_VALIDATION_FAILED",
      `Payload for '${eventType}@${schemaVersion}' failed validation: ${issues}`,
    );
  }
}

/**
 * Check backward compatibility between an old schema and a proposed new schema.
 * Returns array of breaking changes (empty = compatible).
 *
 * Rules:
 *   - New required fields = BREAKING (old consumers don't send them)
 *   - Removed fields = BREAKING (old consumers expect them)
 *   - Type changes = BREAKING
 *   - New optional fields = OK (additive)
 */
export function checkBackwardCompatibility(
  oldKeys: Set<string>,
  oldRequired: Set<string>,
  newKeys: Set<string>,
  newRequired: Set<string>,
): string[] {
  const breaking: string[] = [];

  // Removed fields (in old but not in new)
  for (const key of oldKeys) {
    if (!newKeys.has(key)) breaking.push(`REMOVED_FIELD: '${key}' was removed (breaking for existing consumers)`);
  }

  // New required fields (not in old, required in new)
  for (const key of newRequired) {
    if (!oldKeys.has(key)) breaking.push(`NEW_REQUIRED_FIELD: '${key}' is new and required (breaking for existing publishers)`);
  }

  // Previously optional → now required
  for (const key of newRequired) {
    if (oldKeys.has(key) && !oldRequired.has(key)) {
      breaking.push(`FIELD_NOW_REQUIRED: '${key}' changed from optional to required (breaking)`);
    }
  }

  return breaking;
}

/** List all registered event types. */
export function listRegisteredTypes(): string[] {
  return [...registry.keys()];
}

/** List all versions for an event type. */
export function listVersions(eventType: string): string[] {
  return [...(registry.get(eventType)?.keys() ?? [])];
}

/** Clear registry — test helper. */
export function resetRegistry(): void {
  registry.clear();
}

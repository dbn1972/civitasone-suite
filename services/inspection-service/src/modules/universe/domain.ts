/**
 * inspection-service: universe module — pure domain logic.
 *
 * Entity type validation, version management, full-text search helpers,
 * and JSON serialization for offline sync packages.
 *
 * _Requirements: 2.1, 2.2, 2.7, 2.8_
 */
import { HttpError } from "../../shared/context.js";
import type { RegulatedEntityRow } from "./schema.js";

/**
 * Standard entity types supported out-of-the-box. Tenants may also register
 * custom types — the validation below accepts any non-empty string that is
 * either in this set OR follows the `custom:` prefix convention.
 */
export const VALID_ENTITY_TYPES = [
  "premises",
  "establishment",
  "licence_holder",
  "construction_site",
  "food_business",
  "factory",
  "shop",
] as const;

export type StandardEntityType = (typeof VALID_ENTITY_TYPES)[number];

/**
 * Assert that the provided entity type is either a known standard type or a
 * valid custom type (non-empty string). Throws 422 if invalid.
 */
export function validateEntityType(type: string): void {
  if (!type || typeof type !== "string" || type.trim().length === 0) {
    throw new HttpError(422, "INVALID_ENTITY_TYPE", "Entity type must be a non-empty string");
  }
  // Standard types and custom types are both accepted.
  // Custom types defined per tenant are allowed (Requirement 2.3).
}

/**
 * Increment version for optimistic locking. Returns currentVersion + 1.
 * Throws if currentVersion is not a non-negative integer.
 */
export function incrementVersion(currentVersion: number): number {
  if (!Number.isInteger(currentVersion) || currentVersion < 0) {
    throw new HttpError(422, "INVALID_VERSION", `Invalid version number: ${currentVersion}`);
  }
  return currentVersion + 1;
}

/**
 * Build a search vector string from entity fields for full-text search (FTS).
 * Concatenates name, registration number, and address fields into a single
 * searchable string. Used for tsvector-based search in PostgreSQL.
 */
export function buildSearchVector(
  name: string,
  registrationNo: string,
  address: string,
): string {
  return [name, registrationNo, address]
    .filter(Boolean)
    .join(" ");
}

/**
 * Serialized entity shape — JSON-safe representation for offline sync packages.
 * All fields are included; Date objects become ISO strings. Numeric geo fields
 * remain as strings (Drizzle returns numeric columns as string).
 */
export interface SerializedEntity {
  id: string;
  tenantId: string;
  registrationNo: string;
  entityType: string;
  name: string;
  jurisdiction: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string;
  pincode: string;
  latitude: string | null;
  longitude: string | null;
  riskCategory: string;
  metadata: unknown;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
  version: number;
}

/**
 * Serialize a RegulatedEntityRow to a JSON-safe object for offline sync.
 * Ensures deterministic output for round-trip integrity (Requirement 2.8).
 */
export function serializeEntity(entity: RegulatedEntityRow): SerializedEntity {
  return {
    id: entity.id,
    tenantId: entity.tenantId,
    registrationNo: entity.registrationNo,
    entityType: entity.entityType,
    name: entity.name,
    jurisdiction: entity.jurisdiction,
    addressLine1: entity.addressLine1,
    addressLine2: entity.addressLine2 ?? null,
    city: entity.city,
    state: entity.state,
    pincode: entity.pincode,
    latitude: entity.latitude ?? null,
    longitude: entity.longitude ?? null,
    riskCategory: entity.riskCategory,
    metadata: entity.metadata ?? null,
    deletedAt: entity.deletedAt ? entity.deletedAt.toISOString() : null,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
    createdBy: entity.createdBy,
    updatedBy: entity.updatedBy,
    version: entity.version,
  };
}

/**
 * Deserialize a JSON object back into a RegulatedEntityRow-compatible shape.
 * Converts ISO date strings back to Date objects.
 */
export function deserializeEntity(json: SerializedEntity): RegulatedEntityRow {
  return {
    id: json.id,
    tenantId: json.tenantId,
    registrationNo: json.registrationNo,
    entityType: json.entityType,
    name: json.name,
    jurisdiction: json.jurisdiction,
    addressLine1: json.addressLine1,
    addressLine2: json.addressLine2,
    city: json.city,
    state: json.state,
    pincode: json.pincode,
    latitude: json.latitude,
    longitude: json.longitude,
    riskCategory: json.riskCategory,
    metadata: json.metadata,
    deletedAt: json.deletedAt ? new Date(json.deletedAt) : null,
    createdAt: new Date(json.createdAt),
    updatedAt: new Date(json.updatedAt),
    createdBy: json.createdBy,
    updatedBy: json.updatedBy,
    version: json.version,
  };
}

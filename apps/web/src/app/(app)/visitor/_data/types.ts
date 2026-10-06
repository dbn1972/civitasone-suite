/**
 * visitor feature — shared TypeScript types.
 *
 * Mirrors the visitor-service HTTP contracts (services/visitor-service):
 *   visit-request/schema.ts, location/schema.ts, config-registry/schema.ts,
 *   evacuation/roster.ts, check-in/routes.ts (verify response).
 * These are display-facing shapes; PII columns arrive already decrypted from
 * the service.
 */

export type VisitRequestStatus =
  | "pending_approval"
  | "pre_approved"
  | "approved"
  | "rejected"
  | "auto_rejected"
  | "cancelled"
  | "no_show";

export interface VisitRequest {
  id: string;
  status: VisitRequestStatus;
  purpose: string | null;
  scheduledAt: string | null;
  visitorName: string;
  visitorPhone: string;
  visitorEmail: string | null;
  hostEmployeeId: string;
  locationId: string;
  passType: string;
  visitorCategory: string;
  /** Non-empty => visit touches a restricted zone (secondary approval per policy). */
  permittedAreas: string[];
  rejectionReason: string | null;
  trackingRef: string | null;
  createdAt: string | null;
}

export interface VisitorLocation {
  id: string;
  name: string;
  address: string | null;
  status: string | null;
}

/**
 * One checked-in visitor on the live premises roster.
 *
 * GAP-VISITOR-GUARD-01/03: sourced from the NORMAL role-gated
 * `GET /v1/visitor/check-ins/active` endpoint (not the break-glass evacuation
 * roster), which deliberately returns NO raw phone/email/identity document —
 * so the client never receives that PII. `validUntil` drives the overstay
 * flag (GAP-VISITOR-GUARD-04); `locationId` scopes the display
 * (GAP-VISITOR-GUARD-05).
 */
export interface RosterEntry {
  passId: string;
  visitorName: string;
  hostEmployeeId: string;
  locationId: string;
  checkInTime: string;
  /** Pass validity end; a check-in past this is an overstay. */
  validUntil: string | null;
  /** Server-computed overstay flag (validUntil < now). */
  overstay: boolean;
  evacuated: boolean;
}

/** Raw `data.visitors[]` shape from GET /v1/visitor/check-ins/active. */
export interface ActiveVisitor {
  passId: string;
  locationId: string;
  visitorName: string;
  hostEmployeeId: string;
  checkInTime: string | null;
  validUntil: string | null;
  overstay: boolean;
}

export interface ConfigEntry {
  id: string;
  namespace: string;
  configKey: string;
  value: unknown;
  label: string | null;
  description: string | null;
  active: boolean;
  sortOrder: number;
  version: number;
}

/** POST /v1/visitor/passes/verify response `data`. */
export interface PassVerifyResult {
  valid: boolean;
  passId?: string;
  visitorId?: string;
  locationId?: string;
  passType?: string;
  passNumber?: string;
  permittedAreas?: string[];
  validFrom?: string;
  validUntil?: string;
  watchlistFlagged?: boolean;
  /** Present when valid === false. */
  code?: string;
  message?: string;
}

export const PRESET_NAMES = ["secretariat", "district-office", "hospital"] as const;
export type PresetName = (typeof PRESET_NAMES)[number];

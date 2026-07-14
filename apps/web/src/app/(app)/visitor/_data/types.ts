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

/** One checked-in visitor on the live premises roster. */
export interface RosterEntry {
  passId: string;
  visitorName: string;
  hostName: string;
  checkInTime: string;
  lastKnownGate: string;
  contactNumber: string;
  evacuated: boolean;
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

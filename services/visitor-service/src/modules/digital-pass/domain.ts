/**
 * visitor-service: digital-pass domain logic.
 *
 * Pure logic for Digital_Pass lifecycle: human-readable pass number
 * generation, pass-type validity window computation, RS256 QR JWT
 * generation via `signPassQr`, revocation, and replacement.
 *
 * See design.md "QR Code Generation (RS256-Signed JWT)" and
 * "Property 10: Pass Revocation Invalidates QR".
 */
import { signPassQr, type PassQrPayload } from "../../shared/qr-crypto.js";

export class DomainError extends Error {
  constructor(public code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = "DomainError";
  }
}

// ── Pass Number Generation ────────────────────────────────────────────────

// Uppercase letters + digits, excluding ambiguous characters (0/O, 1/I) for
// manual gate-fallback legibility (Requirement 4.6).
const PASS_NUMBER_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const PASS_NUMBER_LENGTH = 10; // within the 8-12 char target, matches schema.ts varchar(12)

/**
 * Generates a human-readable pass number for manual verification fallback
 * at the gate (Requirement 4.6). Not guaranteed globally unique on its own —
 * the `digital_passes_tenant_id_pass_number_key` unique constraint (per
 * schema.ts) enforces uniqueness scoped to a tenant; callers should retry
 * generation on a unique-constraint violation.
 */
export function generatePassNumber(): string {
  let out = "";
  for (let i = 0; i < PASS_NUMBER_LENGTH; i++) {
    const idx = Math.floor(Math.random() * PASS_NUMBER_ALPHABET.length);
    out += PASS_NUMBER_ALPHABET[idx];
  }
  return out;
}

// ── Validity Window Computation ───────────────────────────────────────────

export type PassType = "single" | "multi_day" | "recurring" | "event";

/** Requirement 4.4 DEFAULT: multi-day pass capped at 7 days from requestedFrom. */
export const MULTI_DAY_MAX_MS = 7 * 24 * 60 * 60 * 1000;
/** Requirement 12.2 DEFAULT: recurring/event pass capped at 90 days. */
export const RECURRING_MAX_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Config-driven caps for pass validity. The HTTP/consumer path resolves these
 * from the tenant's `visitor_policy` config (digital_pass.multi_day_max_days /
 * digital_pass.recurring_max_days) and passes them in; when omitted the module
 * DEFAULTS apply, so behavior is unchanged for an unconfigured tenant.
 */
export interface ValidityCaps {
  multiDayMaxMs?: number;
  recurringMaxMs?: number;
}

/**
 * Computes the [validFrom, validUntil] window for a Digital_Pass based on
 * pass type (Requirement 4.4):
 *  - single: valid from `requestedFrom` through the end of that calendar day.
 *  - multi_day: valid from `requestedFrom` through `requestedUntil`, capped
 *    at a maximum of `caps.multiDayMaxMs` (default 7 days) from `requestedFrom`.
 *  - recurring / event: `requestedUntil`, capped at `caps.recurringMaxMs`
 *    (default 90 days) from `requestedFrom`. The recurring-pass module also
 *    enforces its own cap at request time (design.md Requirement 12.2).
 */
export function computeValidityWindow(
  passType: PassType,
  requestedFrom: Date,
  requestedUntil?: Date,
  caps: ValidityCaps = {},
): { validFrom: Date; validUntil: Date } {
  const multiDayMaxMs = caps.multiDayMaxMs ?? MULTI_DAY_MAX_MS;
  const recurringMaxMs = caps.recurringMaxMs ?? RECURRING_MAX_MS;
  if (passType === "single") {
    const validFrom = requestedFrom;
    const validUntil = new Date(
      requestedFrom.getFullYear(),
      requestedFrom.getMonth(),
      requestedFrom.getDate(),
      23,
      59,
      59,
      999,
    );
    return { validFrom, validUntil };
  }

  if (!requestedUntil) {
    throw new DomainError(
      "MISSING_VALID_UNTIL",
      `requestedUntil is required for pass_type '${passType}'`,
    );
  }

  if (requestedUntil.getTime() <= requestedFrom.getTime()) {
    throw new DomainError(
      "INVALID_WINDOW",
      "requestedUntil must be after requestedFrom",
    );
  }

  if (passType === "multi_day") {
    const maxUntil = new Date(requestedFrom.getTime() + multiDayMaxMs);
    const validUntil = requestedUntil.getTime() > maxUntil.getTime() ? maxUntil : requestedUntil;
    return { validFrom: requestedFrom, validUntil };
  }

  if (passType === "recurring") {
    // recurring — capped at recurringMaxMs from requestedFrom; the recurring-pass
    // module also enforces its own cap at request time (belt-and-braces).
    const maxUntil = new Date(requestedFrom.getTime() + recurringMaxMs);
    const validUntil = requestedUntil.getTime() > maxUntil.getTime() ? maxUntil : requestedUntil;
    return { validFrom: requestedFrom, validUntil };
  }

  // event — pass through as-is (event windows are set by the event, not capped).
  return { validFrom: requestedFrom, validUntil: requestedUntil };
}

// ── Pass Generation ────────────────────────────────────────────────────────

export interface GeneratePassPayload {
  visitId: string;
  visitorId: string;
  tenantId: string;
  locationId: string;
  validFrom: Date;
  validUntil: Date;
  permittedAreas: string[];
  passType: PassType;
}

export interface GeneratedPass {
  passNumber: string;
  qrJwt: string;
  validFrom: Date;
  validUntil: Date;
}

/**
 * Generates a Digital_Pass: a human-readable pass number plus a signed
 * Pass_QR JWT (RS256, tenant/location private key). Converts `validFrom`/
 * `validUntil` `Date`s to Unix epoch seconds for the JWT payload per
 * `PassQrPayload` (Requirement 4.3).
 */
export async function generatePass(
  payload: GeneratePassPayload,
  tenantPrivateKeyPem: string,
): Promise<GeneratedPass> {
  const passNumber = generatePassNumber();

  const qrPayload: PassQrPayload = {
    visit_id: payload.visitId,
    visitor_id: payload.visitorId,
    tenant_id: payload.tenantId,
    location_id: payload.locationId,
    valid_from: Math.floor(payload.validFrom.getTime() / 1000),
    valid_until: Math.floor(payload.validUntil.getTime() / 1000),
    permitted_areas: payload.permittedAreas,
    pass_type: payload.passType,
    pass_number: passNumber,
  };

  const qrJwt = await signPassQr(qrPayload, tenantPrivateKeyPem);

  return {
    passNumber,
    qrJwt,
    validFrom: payload.validFrom,
    validUntil: payload.validUntil,
  };
}

// ── Revocation & Replacement ──────────────────────────────────────────────

/**
 * Throws if the pass has already been revoked. Used before allowing
 * check-in (Property 10: revoking an active pass causes subsequent
 * verification/check-in to fail).
 */
export function assertNotRevoked(pass: { revoked: boolean }): void {
  if (pass.revoked) {
    throw new DomainError("PASS_REVOKED", "digital pass has been revoked");
  }
}

/**
 * Builds the fields to persist when revoking a pass (Requirement 4.5).
 * Pure computation — callers (consumer.ts) perform the actual DB write,
 * Redis revocation-set update, and outbox `passRevoked` event.
 */
export function revokePass(
  pass: { revoked: boolean },
  reason: string,
  now: Date = new Date(),
): { revoked: true; revokedAt: Date; revokeReason: string } {
  assertNotRevoked(pass);
  return { revoked: true, revokedAt: now, revokeReason: reason };
}

/**
 * Generates a replacement pass for a lost/compromised Digital_Pass
 * (Requirement 4.5): produces a new pass number and a new QR JWT distinct
 * from the original. Callers persist the new pass, set `replacedById` on
 * the original pass row to the new pass's ID, and revoke the original.
 */
export async function replacePass(
  payload: GeneratePassPayload,
  tenantPrivateKeyPem: string,
): Promise<GeneratedPass> {
  return generatePass(payload, tenantPrivateKeyPem);
}

// ── Pass Status State Machine ─────────────────────────────────────────────

export type PassStatus = "active" | "checked_in" | "checked_out" | "revoked" | "expired";

const ALLOWED_TRANSITIONS: Record<PassStatus, PassStatus[]> = {
  active: ["checked_in", "revoked", "expired"],
  checked_in: ["checked_out", "revoked"],
  checked_out: ["checked_in"], // multi-day, multi-entry passes may re-enter
  revoked: [],
  expired: [],
};

/**
 * Validates a Digital_Pass status transition (Property 11: active →
 * checked_in → checked_out state machine invariant). Throws DomainError on
 * an invalid transition.
 */
export function assertPassTransition(from: PassStatus, to: PassStatus): void {
  const allowed = ALLOWED_TRANSITIONS[from];
  if (!allowed.includes(to)) {
    throw new DomainError(
      "INVALID_TRANSITION",
      `digital pass cannot transition from '${from}' to '${to}'`,
    );
  }
}

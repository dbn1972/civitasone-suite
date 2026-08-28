import { randomInt } from "node:crypto";
import { determineRequiredNocs } from "../applications/domain.js";

export const PERMIT_STATUSES = ["issued", "active", "completed", "revoked"] as const;
export type PermitStatus = (typeof PERMIT_STATUSES)[number];

const VALID_TRANSITIONS: Record<string, PermitStatus[]> = {
  // No "activate" command exists in this module today — "active" stays an
  // unreachable status as it already was; not expanding scope to invent one.
  issued: ["active", "revoked"],
  active: ["completed", "revoked"],
  completed: [],
  revoked: [],
};

export function canRevoke(status: string): boolean {
  return fromStatusesFor("revoked").includes(status as PermitStatus);
}

export function fromStatusesFor(to: PermitStatus): PermitStatus[] {
  return (Object.keys(VALID_TRANSITIONS) as PermitStatus[]).filter((from) =>
    (VALID_TRANSITIONS[from] ?? []).includes(to),
  );
}

export function generatePermitNumber(tenantShortCode: string, sequence: number): string {
  const year = new Date().getUTCFullYear();
  return `EVTP/${tenantShortCode}/${year}/${String(sequence).padStart(6, "0")}`;
}

// Was Math.random().toString(36)... — a non-cryptographic PRNG for a code whose
// entire purpose is field verification of permit authenticity (an officer or
// citizen checks a physical permit is real via GET /v1/event/nocs/verify-style
// lookup). crypto.randomInt is the drop-in-safe replacement; keeps the same
// shape (8 uppercase base36 chars).
export function generateVerificationCode(): string {
  const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += alphabet[randomInt(0, alphabet.length)];
  }
  return code;
}

/**
 * The complement of {draft, withdrawn, rejected} (and the already-terminal
 * permitted/completed) — see checkPermitEligibility's comment for why this
 * doesn't just require "approved". Exported so permits/consumer.ts's
 * appRepo.updateStatus call uses the EXACT same from-set this eligibility
 * check allows, rather than a second, independently-drifting list. (Using
 * applications/domain.ts's own fromStatusesFor("permitted") here would be
 * wrong: that resolves to ["approved"] only, which — since "approved" is
 * unreachable — would make appRepo.updateStatus never match, aborting every
 * permit issuance after this eligibility check had already approved it.)
 */
export const PERMIT_ELIGIBLE_APPLICATION_STATUSES: string[] = [
  "submitted",
  "noc_pending",
  "nocs_received",
  "approved",
];

export interface PermitEligibilityApplication {
  status: string;
  eventType: string;
  expectedAttendance: number;
  soundPermission: boolean;
}

export interface PermitEligibilityNoc {
  department: string;
  status: string;
}

/**
 * The headline fix in this PR: previously NOTHING checked that an application
 * had passing NOCs, or was even in an approved status, before a permit was
 * issued for it — issuePermit's consumer never referenced the nocs or
 * applications modules for eligibility at all (only to flip the application's
 * OWN status afterward). determineRequiredNocs() already existed for exactly
 * this purpose and was dead code — never called anywhere. This ties it, the
 * application's own state machine, and the actual NOC records together into a
 * single eligibility check callable from both the route (fast 422) and the
 * consumer (the real gate, atomic with the actual DB write).
 */
export function checkPermitEligibility(
  application: PermitEligibilityApplication | null,
  nocs: PermitEligibilityNoc[],
): { eligible: boolean; reason: string } {
  if (!application) return { eligible: false, reason: "Application not found" };
  // NOTE on the status gate: the applications module's own state machine
  // models "approved" as the prerequisite for "permitted" (see
  // applications/domain.ts's VALID_TRANSITIONS) — but there is no
  // approve/reject command implemented ANYWHERE in this service. "approved"
  // and "rejected" are unreachable states given the current feature set
  // (confirmed: only draft -> submitted -> withdrawn are ever actually set by
  // any code path). Gating strictly on the modeled "approved" precondition
  // would make permit issuance entirely unreachable, not just more correct —
  // that's a missing-feature problem (no approve/reject workflow exists),
  // flagged separately in the PR description, not silently built here. This
  // gates on the achievable minimum instead: the application must have been
  // submitted and must not have been withdrawn or (if a future
  // approve/reject workflow lands) rejected.
  if (!PERMIT_ELIGIBLE_APPLICATION_STATUSES.includes(application.status)) {
    return { eligible: false, reason: `Application is in status '${application.status}', which cannot receive a permit` };
  }
  const required = determineRequiredNocs(application.eventType, application.expectedAttendance, application.soundPermission);
  const approvedDepartments = new Set(
    nocs.filter((n) => n.status === "approved" || n.status === "conditional").map((n) => n.department),
  );
  const missing = required.filter((dept) => !approvedDepartments.has(dept));
  if (missing.length > 0) {
    return { eligible: false, reason: `Missing an approved NOC for: ${missing.join(", ")}` };
  }
  return { eligible: true, reason: "" };
}

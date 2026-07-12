/**
 * court feature — shared TypeScript types.
 *
 * Mirrors the court-service HTTP contracts (services/court-service):
 *   case-registry/schema.ts (cases, case_parties), case-lifecycle/domain.ts
 *   (CASE_STATUSES + transition spine), order/schema.ts + order-issuance
 *   (orders, maker-checker), hearing/schema.ts (hearings), cause-list/schema.ts
 *   (cause_lists, cause_list_items), config-registry/schema.ts (config_entries).
 *
 * These are display-facing shapes assembled from the gateway responses; the
 * gateway maps /api/v1/court/* → the service's internal /v1/court/*.
 */

// ─── Cases ─────────────────────────────────────────────────────────────────

/** case-registry/domain.ts CASE_STATUSES (the lifecycle spine). */
export const CASE_STATUSES = [
  "filed",
  "registered",
  "admitted",
  "pending",
  "part_heard",
  "reserved",
  "disposed",
  "appealed",
] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

/**
 * The permitted forward/side transitions per status (case-registry/domain.ts
 * TRANSITIONS). Kept here so the console can offer only the moves the server
 * will accept — the service still authoritatively enforces it.
 */
export const CASE_TRANSITIONS: Record<CaseStatus, CaseStatus[]> = {
  filed: ["registered"],
  registered: ["admitted"],
  admitted: ["pending"],
  pending: ["part_heard", "reserved", "disposed"],
  part_heard: ["reserved", "pending", "disposed"],
  reserved: ["disposed", "part_heard"],
  disposed: ["appealed"],
  appealed: ["pending"],
};

/** A party (petitioner/respondent/advocate/…) on a case. PII is server-side
 *  encrypted; the gateway returns decrypted display values where permitted. */
export interface CaseParty {
  id: string;
  caseId: string;
  partyRole: string;
  name: string | null;
  advocateName: string | null;
  advocateBarId: string | null;
  version: number;
}

export interface CourtCase {
  id: string;
  cnrNumber: string;
  caseType: string | null;
  filingNumber: string | null;
  filingDate: string | null;
  title: string | null;
  status: CaseStatus;
  stage: string | null;
  courtId: string | null;
  benchId: string | null;
  disposalDate: string | null;
  targetDisposalDate: string | null;
  version: number;
}

export interface CourtCaseDetail extends CourtCase {
  parties: CaseParty[];
}

/** Pendency roll-up (case-registry pendencySummary). */
export interface PendencyRow {
  status: string;
  count: number;
}
export interface Pendency {
  summary: PendencyRow[];
  total: number;
}

/** NCMS-style analytics summary (case-registry caseAnalytics + clearance). */
export interface CaseAnalytics {
  instituted: number;
  disposed: number;
  clearanceRatePct: number | null;
}

// ─── Orders + issuance (maker-checker) ───────────────────────────────────────

/** order/schema.ts orders.status: draft → pending_approval → issued | recalled. */
export type OrderStatus = "draft" | "pending_approval" | "issued" | "recalled";

export interface CourtOrder {
  id: string;
  caseId: string;
  hearingId: string | null;
  orderType: string | null;
  orderText: string | null;
  status: OrderStatus;
  orderDate: string | null;
  signedBy: string | null;
  approvedBy: string | null;
  issuedAt: string | null;
  recallReason: string | null;
  hasDsc: boolean;
  createdBy: string | null;
  version: number;
}

// ─── Hearings ────────────────────────────────────────────────────────────────

export interface Hearing {
  id: string;
  caseId: string;
  benchId: string | null;
  scheduledDate: string | null;
  status: string;
  nextDate: string | null;
  purpose: string | null;
  adjournmentReason: string | null;
  version: number;
}

// ─── Cause list ──────────────────────────────────────────────────────────────

export interface CauseListItem {
  id: string;
  causeListId: string;
  caseId: string;
  itemNumber: number | null;
  slot: string | null;
  courtroom: string | null;
  listDate: string | null;
  version: number;
}

/** POST /cause-lists accepted envelope (write path → 202). */
export interface CauseListRef {
  id: string;
  courtId?: string;
  listDate?: string;
}

// ─── Config engine (§47) ─────────────────────────────────────────────────────

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

/** Vertical onboarding presets (config-registry/presets.ts VERTICAL_PRESETS keys). */
export const PRESET_NAMES = ["revenue", "consumer", "tribunal"] as const;
export type PresetName = (typeof PRESET_NAMES)[number];

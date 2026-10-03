import { rupeesToMinorString } from "@/lib/money";

/**
 * Pure helpers for the offer approval workflow dialog (GAP-RECRUITMENT-DETAIL-05). The service owns
 * every rule (maker != checker, approval chain order, release only when approved); these helpers only
 * decide which buttons to OFFER so the UI never invites an action the service is certain to refuse.
 */

export type OfferStageDef = { stage: string; role: string };

export type OfferView = {
  id: string;
  offerNo: string | null;
  offerVersion: number;
  status: string;
  basicMinor: string;
  joiningBonusMinor: string;
  relocationMinor: string;
  variablePayMinor: string;
  grossCtcMinor: string;
  grade: string | null;
  payLevel: string | null;
  payCell: number | null;
  joiningDate: string | null;
  approvalChain: OfferStageDef[];
  currentStage: number;
  createdBy: string;
};

const TERMINAL = ["accepted", "declined", "withdrawn", "expired", "revised"] as const;

/** The newest offer that is still live (the list arrives newest-version first). */
export function activeOffer(offers: readonly OfferView[]): OfferView | null {
  return offers.find((o) => !(TERMINAL as readonly string[]).includes(o.status)) ?? null;
}

export type OfferActionState = {
  canSubmit: boolean;
  canApprove: boolean;
  canReturn: boolean;
  canRelease: boolean;
  /** Role of the approver the offer is waiting on, when pending approval. */
  awaitingRole: string | null;
  awaitingStage: string | null;
  /** Why Approve is not offered although the offer is pending. */
  approveBlockedReason: "creator" | "role" | null;
};

const HR_ROLES = ["hr_admin", "hr_officer", "super_admin"];

export function offerActions(offer: OfferView, who: { userId: string | null; roles: readonly string[] }): OfferActionState {
  const isHr = who.roles.some((r) => HR_ROLES.includes(r));
  const base: OfferActionState = {
    canSubmit: false, canApprove: false, canReturn: false, canRelease: false,
    awaitingRole: null, awaitingStage: null, approveBlockedReason: null,
  };
  if (offer.status === "draft" || offer.status === "returned") return { ...base, canSubmit: isHr };
  if (offer.status === "approved") return { ...base, canRelease: isHr };
  if (offer.status === "pending_approval") {
    const stage = offer.approvalChain[offer.currentStage];
    const role = stage?.role ?? null;
    const roleOk = role !== null && (who.roles.includes(role) || who.roles.includes("super_admin"));
    const isCreator = who.userId !== null && who.userId === offer.createdBy;
    return {
      ...base,
      awaitingRole: role, awaitingStage: stage?.stage ?? null,
      canApprove: roleOk && !isCreator,
      canReturn: roleOk,
      approveBlockedReason: !roleOk ? "role" : isCreator ? "creator" : null,
    };
  }
  return base;
}

export type OfferForm = {
  basic: string; joiningBonus: string; relocation: string; variablePay: string;
  grade: string; payLevel: string; payCell: string; joiningDate: string;
};

export const EMPTY_OFFER_FORM: OfferForm = { basic: "", joiningBonus: "", relocation: "", variablePay: "", grade: "", payLevel: "", payCell: "", joiningDate: "" };

export type OfferPayload = {
  basicMinor: number; joiningBonusMinor?: number; relocationMinor?: number; variablePayMinor?: number;
  grade?: string; payLevel?: number; payCell?: number; joiningDate?: string;
};

export type OfferFormError = "basic" | "amount" | "payLevelCell";

function optionalMinor(v: string): number | null | "bad" {
  if (v.trim() === "") return null;
  const m = rupeesToMinorString(v, { allowZero: true });
  if (m === null) return "bad";
  const n = Number(m);
  return Number.isSafeInteger(n) ? n : "bad";
}

/** Exact decimal parse (no float multiply; sub-paise rejected). Basic pay must be positive. */
export function buildOfferPayload(f: OfferForm): { ok: true; payload: OfferPayload } | { ok: false; error: OfferFormError } {
  const basicM = rupeesToMinorString(f.basic);
  const basic = basicM === null ? Number.NaN : Number(basicM);
  if (!Number.isSafeInteger(basic) || basic <= 0) return { ok: false, error: "basic" };
  const payload: OfferPayload = { basicMinor: basic };
  const extras: Array<["joiningBonusMinor" | "relocationMinor" | "variablePayMinor", string]> = [
    ["joiningBonusMinor", f.joiningBonus], ["relocationMinor", f.relocation], ["variablePayMinor", f.variablePay],
  ];
  for (const [key, raw] of extras) {
    const v = optionalMinor(raw);
    if (v === "bad") return { ok: false, error: "amount" };
    if (v !== null) payload[key] = v;
  }
  const hasLevel = f.payLevel.trim() !== "";
  const hasCell = f.payCell.trim() !== "";
  if (hasLevel !== hasCell) return { ok: false, error: "payLevelCell" };
  if (hasLevel) {
    const level = Number(f.payLevel);
    const cell = Number(f.payCell);
    if (!Number.isInteger(level) || level < 1 || level > 18 || !Number.isInteger(cell) || cell < 1 || cell > 40) return { ok: false, error: "payLevelCell" };
    payload.payLevel = level;
    payload.payCell = cell;
  }
  if (f.grade.trim()) payload.grade = f.grade.trim();
  if (f.joiningDate) payload.joiningDate = f.joiningDate;
  return { ok: true, payload };
}

/**
 * srn module — pure domain logic for the Store Receipt Note (SRN) lifecycle.
 *
 * GFR Rule 149 requires a signed SRN — the store officer's physical
 * acceptance of goods into store — before any payment against the
 * corresponding GRN can be authorised. An SRN can only be created once the
 * GRN itself has passed inspection ('accepted'); it starts life as 'draft'
 * and becomes 'signed' when the store officer confirms receipt.
 *
 * Requirements: 1.1
 */
import { DomainError } from "../../shared/domain.js";

/** Minimal shape of a remote GRN summary needed to gate SRN creation. */
export interface GrnRow {
  status: string;
}

/** Minimal shape of a persisted SRN row needed to gate the sign transition. */
export interface SrnRow {
  status: "draft" | "signed";
}

/**
 * An SRN can only be raised against a GRN that has passed inspection.
 * Creating one against a draft/under_inspection/rejected GRN would record
 * store acceptance of goods that were never formally accepted procurement-side.
 */
export function canCreateSrn(grn: GrnRow): boolean {
  return grn.status === "accepted";
}

/** An SRN can only be signed once — signing a signed SRN is a no-op guard, not a re-sign. */
export function canSignSrn(srn: SrnRow): boolean {
  return srn.status === "draft";
}

export { DomainError };

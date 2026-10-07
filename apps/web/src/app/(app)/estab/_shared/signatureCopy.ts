/**
 * GAP-ESTAB-APPROVALS-02: one honest description of what an establishment
 * "approval" and "sign" currently are, shared by the Approvals queue and the
 * DFA panel so the product never makes contradictory legal claims.
 *
 * DECISION (safest / honest default, flagged for HUMAN REVIEW): cryptographic
 * DSC e-signature is NOT live (DfaPanel historically said "Cryptographic
 * e-Sign/DSC arrives in Phase 2"). The Approvals queue previously claimed it
 * "records your DSC e-signature" / "DSC e-Signed", which is a false legal
 * claim on a government file noting. Until DSC signing is actually wired, the
 * copy states the truth: an approval records WHO approved, WHEN, and their
 * REMARKS on the noting — it does not apply a digital signature certificate.
 */

/** What approving a noting actually does today (no DSC applied). */
export const APPROVAL_RECORDS_COPY =
  "This records your approval — your name, the time, and your remarks — on the file noting and forwards it up the SO → US → DS chain. A cryptographic DSC digital signature is not applied. This cannot be undone.";

/** What signing a DFA actually does today (no DSC applied). */
export const SIGN_RECORDS_COPY =
  "Records who signed and when. A cryptographic DSC digital signature is not applied yet.";

/** Button + success labels, kept neutral of any "e-Sign/DSC" claim. */
export const APPROVE_BUTTON_LABEL = "Approve";
export const APPROVED_SUBTITLE = "Approve yellow notes to green.";

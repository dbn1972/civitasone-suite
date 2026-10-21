/**
 * GAP-ESTAB-APPROVALS-02: one honest description of what an establishment
 * "approval" and "sign" currently are, shared by the Approvals queue, the DFA
 * panel and the file-detail sign dialog so the product never makes
 * contradictory legal claims about the signature.
 *
 * DECISION (safest / honest default, flagged for HUMAN REVIEW): cryptographic
 * DSC e-signature is NOT live. The Approvals queue previously claimed it
 * "records your DSC e-signature" / "DSC e-Signed", which is a false legal
 * claim on a government file noting. Until DSC signing is actually wired, the
 * copy states the truth: an approval records WHO approved, WHEN, and their
 * REMARKS on the noting; a sign records who signed and when; neither applies a
 * digital signature certificate.
 */

/** The one sentence every approval / sign surface uses about DSC. */
export const DSC_NOT_APPLIED_COPY = "A cryptographic DSC digital signature is not applied yet.";

/** What approving a noting actually does today (no DSC applied). */
export const APPROVAL_RECORDS_COPY =
  `This records your approval — your name, the time, and your remarks — on the file noting and passes it to the next approver where the chain has one. ${DSC_NOT_APPLIED_COPY} This cannot be undone.`;

/** What signing a DFA actually does today (no DSC applied). */
export const SIGN_RECORDS_COPY = `Records who signed and when. ${DSC_NOT_APPLIED_COPY}`;

/** What signing a note as a green note actually does today (no DSC applied). */
export const NOTE_SIGN_RECORDS_COPY =
  `This records your signature — your name and the time — into the file's tamper-evident (hash-chained) noting trail as a green note in your name. ${DSC_NOT_APPLIED_COPY} A signed note cannot be edited or withdrawn.`;

/**
 * What a signed note is called wherever it is listed (the file detail's Notes column): it is
 * signed into the hash-chained trail, with no DSC applied, so it is not called "e-Signed".
 */
export const NOTE_SIGNED_LABEL = "Signed (hash-chained note)";

/** Button + success labels, kept neutral of any "e-Sign/DSC" claim. */
export const APPROVE_BUTTON_LABEL = "Approve";
export const APPROVED_SUBTITLE = "Approve yellow notes to green.";

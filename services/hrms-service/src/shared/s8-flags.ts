/**
 * Section 8 (wave 1) feature flags for HRMS. Every flag defaults OFF; an unset value, or any value other than the
 * exact string "true", is OFF. Read per call (not at import) so a test or an operator can flip them without module
 * state. Nothing gated by these may change behaviour for an existing tenant while OFF.
 */
const on = (name: string): boolean => process.env[name] === "true";

/** G6: PAN / bank account + IFSC / UAN / cost-centre / pay-structure columns accepted by POST /v1/hrms/employees/bulk. */
export const bulkSensitiveImportEnabled = (): boolean => on("HRMS_S8_BULK_IMPORT_ENABLED");
/** G6: POST /v1/hrms/pay-profiles/bulk-request and /bulk-decision. */
export const bulkPayProfileEnabled = (): boolean => on("HRMS_S8_BULK_PAY_PROFILE_ENABLED");
/** G6: the employee detail read returns the UAN MASKED (revealable, audited, via POST /v1/hrms/pii/reveal). */
export const uanMaskedEnabled = (): boolean => on("HRMS_S8_UAN_MASK_ENABLED");

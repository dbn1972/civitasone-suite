/**
 * GAP-PAYROLL-STATUTORY-PT-02: the sentinel paise value a slab uses for an
 * open-ended ("no upper bound") range. Shared by the version form (which
 * writes it) and the page (which must recognise it and print "No upper bound"
 * instead of formatting it as ₹9,99,99,99,999.99). Do NOT change this value
 * without backend agreement -- the PT engine compares stored slab_to_minor
 * values against it.
 */
export const PT_NO_UPPER_BOUND_MINOR = 999_999_999_999;

/**
 * Article 276(2) of the Constitution: professional tax cannot exceed ₹2,500
 * per person per financial year (paise). The run engine enforces it; the form
 * uses it to refuse a single month's amount above it.
 */
export const PT_ANNUAL_CAP_MINOR = 250_000;

/**
 * Who may create a new slab version. Mirrors payroll-service
 * (pt-versions-routes.ts PT_ADMIN_ROLES): payroll_admin and super_admin only --
 * a payroll_officer can read the timeline but not change statutory slabs.
 */
export const PT_VERSION_ADMIN_ROLES = ["payroll_admin", "super_admin"];

/** Which employees a slab applies to (payroll-service PT_GENDERS). A slab of the employee's own gender wins over an "all" slab. */
export const PT_GENDERS = ["all", "female", "male"] as const;
export type PtGender = (typeof PT_GENDERS)[number];
export const isPtGender = (v: unknown): v is PtGender => v === "all" || v === "female" || v === "male";

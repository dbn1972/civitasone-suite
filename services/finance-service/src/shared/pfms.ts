/** PFMS field validators — HoA (18-digit) and DDO code. */

export class PfmsValidationError extends Error {
  constructor(public code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = "PfmsValidationError";
  }
}

/** PFMS Head of Account: exactly 18 numeric digits (Major+SubMajor+Minor+…). */
export const PFMS_HOA_REGEX = /^\d{18}$/;

/** DDO code assigned by PAO — 6–12 alphanumeric characters. */
export const PFMS_DDO_REGEX = /^[A-Z0-9]{6,12}$/i;

/** Agency code — 4–12 alphanumeric (PFMS agency registry). */
export const PFMS_AGENCY_REGEX = /^[A-Z0-9]{4,12}$/i;

/** Scheme code — 4–20 alphanumeric. */
export const PFMS_SCHEME_REGEX = /^[A-Z0-9]{4,20}$/i;

export function assertValidAgencyCode(code: string | null | undefined): void {
  if (!code || !PFMS_AGENCY_REGEX.test(code)) {
    throw new PfmsValidationError("INVALID_AGENCY_CODE", "agency code must be 4–12 alphanumeric characters");
  }
}

export function assertValidSchemeCode(code: string | null | undefined): void {
  if (!code || !PFMS_SCHEME_REGEX.test(code)) {
    throw new PfmsValidationError("INVALID_SCHEME_CODE", "scheme code must be 4–20 alphanumeric characters");
  }
}

export function assertValidPfmsHoA(hoaCode: string | null | undefined): void {
  if (!hoaCode || !PFMS_HOA_REGEX.test(hoaCode)) {
    throw new PfmsValidationError(
      "INVALID_HOA_CODE",
      "head of account must be exactly 18 numeric digits (PFMS format)",
    );
  }
}

export function assertValidDdoCode(ddoCode: string | null | undefined): void {
  if (!ddoCode || !PFMS_DDO_REGEX.test(ddoCode)) {
    throw new PfmsValidationError(
      "INVALID_DDO_CODE",
      "DDO code must be 6–12 alphanumeric characters (PFMS format)",
    );
  }
}

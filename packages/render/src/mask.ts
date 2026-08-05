/**
 * PII masking for export data rows.
 *
 * Masks identified PII columns with `***` based on the exporting user's role.
 * PII columns are identified by a configurable list passed in by the caller
 * (from schema x-pii annotations or template piiColumns field).
 */

/**
 * Mask PII columns in export rows based on user role.
 *
 * If the user's role is in `allowedRoles`, rows are returned unchanged.
 * Otherwise, PII columns are masked: first 2 chars + "***" + last char for
 * strings ≥ 4 chars; "***" for shorter strings or non-string values.
 * null/undefined values are left unchanged.
 *
 * @param rows - Array of data rows to mask
 * @param piiColumns - List of column keys that contain PII
 * @param role - The exporting user's role
 * @param allowedRoles - Roles that are permitted to see unmasked PII
 * @returns Masked (or unchanged) rows
 */
export function maskPiiColumns(
  rows: Record<string, unknown>[],
  piiColumns: string[],
  role: string,
  allowedRoles: string[],
): Record<string, unknown>[] {
  // If user's role is allowed, return rows unchanged
  if (allowedRoles.includes(role)) {
    return rows;
  }

  // No PII columns specified — nothing to mask
  if (piiColumns.length === 0) {
    return rows;
  }

  // Build a Set for O(1) lookup
  const piiSet = new Set(piiColumns);

  return rows.map((row) => {
    const masked: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      if (piiSet.has(key)) {
        masked[key] = maskValue(value);
      } else {
        masked[key] = value;
      }
    }
    return masked;
  });
}

/**
 * Mask a single value.
 * - null/undefined → unchanged
 * - string ≥ 4 chars → first 2 chars + "***" + last char
 * - string < 4 chars → "***"
 * - non-string → "***"
 */
export function maskValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === "string") {
    if (value.length >= 4) {
      return `${value.slice(0, 2)}***${value.slice(-1)}`;
    }
    return "***";
  }

  // Numbers, booleans, objects — fully masked
  return "***";
}

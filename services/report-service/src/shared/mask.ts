/**
 * PII masking for export data rows.
 *
 * Re-exports from @civitasone/render mask module.
 * Local re-export allows monorepo worktree resolution to work
 * regardless of whether the render package dist is built.
 */

/**
 * Mask PII columns in export rows based on user role.
 *
 * If the user's role is in `allowedRoles`, rows are returned unchanged.
 * Otherwise, PII columns are masked: first 2 chars + "***" + last char for
 * strings ≥ 4 chars; "***" for shorter strings or non-string values.
 * null/undefined values are left unchanged.
 */
export function maskPiiColumns(
  rows: Record<string, unknown>[],
  piiColumns: string[],
  role: string,
  allowedRoles: string[],
): Record<string, unknown>[] {
  if (allowedRoles.includes(role)) {
    return rows;
  }
  if (piiColumns.length === 0) {
    return rows;
  }

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
  return "***";
}

/**
 * Payroll run warnings (GET /v1/payroll/runs/:id/warnings): defensive parsing and the
 * per-code presentation rules, kept pure so the panel holds no list logic.
 */
export type RunWarningEmployee = { employeeId: string; employeeNo: string };
export type RunWarning = { code: string; count: number; sample: RunWarningEmployee[] };

/** Codes the engine emits today; any other code is shown with a generic message. */
export const KNOWN_WARNING_CODES = ["PT_STATE_UNKNOWN", "PT_GENDER_UNKNOWN", "HRA_FLOOR_NOT_CONFIGURED"] as const;
export type KnownWarningCode = (typeof KNOWN_WARNING_CODES)[number];
export const isKnownWarningCode = (c: string): c is KnownWarningCode => (KNOWN_WARNING_CODES as readonly string[]).includes(c);

/** null = the payload is not the expected shape (a load error, never "no warnings"). */
export function parseRunWarnings(p: unknown): RunWarning[] | null {
  if (!p || typeof p !== "object" || !Array.isArray((p as { warnings?: unknown }).warnings)) return null;
  const out: RunWarning[] = [];
  for (const w of (p as { warnings: unknown[] }).warnings) {
    const x = w as { code?: unknown; count?: unknown; sample?: unknown };
    if (typeof x?.code !== "string") return null;
    const sample: RunWarningEmployee[] = [];
    for (const s of Array.isArray(x.sample) ? x.sample : []) {
      const e = s as { employeeId?: unknown; employeeNo?: unknown };
      if (typeof e?.employeeId === "string" && typeof e?.employeeNo === "string") sample.push({ employeeId: e.employeeId, employeeNo: e.employeeNo });
    }
    out.push({ code: x.code, count: Number(x.count) || 0, sample });
  }
  return out;
}

/** Warnings whose affected employees are fixed on the employee edit page (state / gender live there). */
export const warningLinksToEmployees = (code: string): boolean => code === "PT_STATE_UNKNOWN" || code === "PT_GENDER_UNKNOWN";

export const employeeEditHref = (employeeId: string): string => `/hr/employees/${encodeURIComponent(employeeId)}/edit`;

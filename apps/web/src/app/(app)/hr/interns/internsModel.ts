import { formatIndianDate, formatMoney } from "@/lib/formatters";

/**
 * GAP-HR-WORKFORCE-INTERNS-01: pure join of the employee register's
 * interns/apprentices with the apprenticeship engagements (the only place a
 * stipend and a training period exist -- /v1/hrms/apprenticeships). Only
 * apprentices have an engagement row; plain interns have no stipend/period data
 * anywhere in the backend, so those cells are an honest em dash, not a guess.
 * Money stays in paise (a string off the wire) until formatMoney renders it.
 */
export type ApiEmployee = {
  id: string;
  name: string;
  department: string;
  employeeType: string;
  status: string;
};

export type ApiApprenticeship = {
  apprenticeId: string;
  monthlyStipendMinor?: string | number | null;
  trainingStart?: string | null;
  trainingEnd?: string | null;
  status?: string | null;
};

export type InternRow = {
  id: string;
  name: string;
  department: string;
  type: string;
  status: string;
  stipend: string;
  period: string;
} & Record<string, unknown>;

const INTERN_TYPES = new Set(["intern", "apprentice", "internship", "apprenticeship"]);

/** Server-side filter value covering every type mapInterns accepts (the API matches case-insensitively). */
export const INTERN_TYPES_QUERY = [...INTERN_TYPES].join(",");

/** Page size requested from the employees API (listQuerySchema max is 500). */
export const INTERNS_PAGE_LIMIT = 500;

/** The API returned a full page, so more matching employees may exist beyond it (hasMore === length === limit). */
export function isRegisterCapped(fetchedCount: number): boolean {
  return fetchedCount >= INTERNS_PAGE_LIMIT;
}
const DASH = "—";

/** Pick the engagement to show per apprentice: the active one, else the latest-starting. */
function pickEngagements(list: readonly ApiApprenticeship[]): Map<string, ApiApprenticeship> {
  const byId = new Map<string, ApiApprenticeship>();
  for (const a of list) {
    const cur = byId.get(a.apprenticeId);
    if (!cur) { byId.set(a.apprenticeId, a); continue; }
    const curActive = cur.status === "active";
    const aActive = a.status === "active";
    if (aActive && !curActive) byId.set(a.apprenticeId, a);
    else if (aActive === curActive && (a.trainingStart ?? "") > (cur.trainingStart ?? "")) byId.set(a.apprenticeId, a);
  }
  return byId;
}

/** Union of the per-type employee lists, de-duplicated by id (first occurrence wins). */
export function mergeEmployees(...lists: readonly (readonly ApiEmployee[])[]): ApiEmployee[] {
  const seen = new Set<string>();
  const out: ApiEmployee[] = [];
  for (const list of lists) {
    for (const e of list) {
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      out.push(e);
    }
  }
  return out;
}

export function mapInterns(employees: readonly ApiEmployee[], apprenticeships: readonly ApiApprenticeship[]): InternRow[] {
  const engagements = pickEngagements(apprenticeships);
  return employees
    .filter((e) => INTERN_TYPES.has((e.employeeType ?? "").toLowerCase()))
    .map((e) => {
      const eng = engagements.get(e.id);
      const hasStipend = eng?.monthlyStipendMinor !== undefined && eng?.monthlyStipendMinor !== null;
      const from = eng?.trainingStart ? formatIndianDate(eng.trainingStart) : null;
      const to = eng?.trainingEnd ? formatIndianDate(eng.trainingEnd) : null;
      return {
        id: e.id,
        name: e.name,
        department: e.department ?? DASH,
        type: e.employeeType.replace(/^./, (c) => c.toUpperCase()),
        status: e.status,
        stipend: hasStipend ? formatMoney(eng!.monthlyStipendMinor as string | number) : DASH,
        period: from ? `${from} – ${to ?? "…"}` : DASH,
      };
    });
}

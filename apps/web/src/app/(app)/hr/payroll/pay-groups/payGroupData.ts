import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import type { DdoOption, GroupOption, UnassignedRow } from "./payGroupMembership";

/**
 * Server-side loaders shared by the pay-group pages and the run form's page.
 * Every loader resolves `{ data, source }` and never throws; callers must
 * check `source` before treating an empty `data` as "none".
 */

function rowsOf(p: unknown): unknown[] | null {
  const arr = Array.isArray(p) ? p : (p as { data?: unknown } | null)?.data;
  return Array.isArray(arr) ? arr : null;
}

/** Active pay groups as {id, name} -- Move / Assign / run-scope targets. */
export function getActiveGroups(): Promise<LoaderResult<GroupOption[]>> {
  return fetchJson<unknown, GroupOption[]>("/api/v1/payroll/pay-groups", [], {
    telemetryKey: "payroll.pay-group.targets",
    mapResponse: (p) => {
      const arr = rowsOf(p);
      if (!arr) return null;
      return (arr as Array<{ id?: unknown; name?: unknown; status?: unknown }>)
        .filter((g) => typeof g.id === "string" && typeof g.name === "string" && g.status === "active")
        .map((g) => ({ id: g.id as string, name: g.name as string }));
    },
  });
}

/** Active DDOs only (a pay group / run can only name an active DDO). */
export function getActiveDdos(): Promise<LoaderResult<DdoOption[]>> {
  return fetchJson<unknown, DdoOption[]>("/api/v1/payroll/ddos", [], {
    telemetryKey: "payroll.pay-group.ddos",
    mapResponse: (p) => {
      const arr = rowsOf(p);
      if (!arr) return null;
      return (arr as Array<{ ddoCode?: unknown; name?: unknown; isActive?: unknown }>)
        .filter((d) => typeof d.ddoCode === "string" && typeof d.name === "string" && d.isActive !== false)
        .map((d) => ({ ddoCode: d.ddoCode as string, name: d.name as string }));
    },
  });
}

export type UnassignedPage = { month: string; total: number; data: UnassignedRow[] };

export function getUnassigned(month: string, limit: number, offset: number): Promise<LoaderResult<UnassignedPage>> {
  return fetchJson<unknown, UnassignedPage>(
    `/api/v1/payroll/pay-groups/unassigned?month=${encodeURIComponent(month)}&limit=${limit}&offset=${offset}`,
    { month, total: 0, data: [] },
    {
      telemetryKey: "payroll.pay-group.unassigned",
      mapResponse: (p) => {
        const o = p as { month?: unknown; total?: unknown; data?: unknown } | null;
        if (!o || !Array.isArray(o.data)) return null;
        return {
          month: typeof o.month === "string" ? o.month : month,
          total: typeof o.total === "number" ? o.total : o.data.length,
          data: o.data as UnassignedRow[],
        };
      },
    },
  );
}

/** Just the count of unassigned employees for the month, or null data when it could not be loaded. */
export function getUnassignedTotal(month: string): Promise<LoaderResult<number | null>> {
  return fetchJson<unknown, number | null>(
    `/api/v1/payroll/pay-groups/unassigned?month=${encodeURIComponent(month)}&limit=1&offset=0`,
    null,
    {
      telemetryKey: "payroll.pay-group.unassigned-total",
      mapResponse: (p) => {
        const total = (p as { total?: unknown } | null)?.total;
        return typeof total === "number" ? total : null;
      },
    },
  );
}

/** Tenant membership setting; `data` is null when it could not be loaded. */
export function getMembershipSettings(): Promise<LoaderResult<boolean | null>> {
  return fetchJson<unknown, boolean | null>("/api/v1/payroll/pay-group-settings", null, {
    telemetryKey: "payroll.pay-group.settings",
    mapResponse: (p) => {
      const v = (p as { allowMidMonthEffective?: unknown } | null)?.allowMidMonthEffective;
      return typeof v === "boolean" ? v : null;
    },
  });
}

export type EmployeePayGroupEntry = {
  payGroupId: string;
  payGroupName: string;
  ddoCode: string | null;
  billType: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  reason?: string | null;
};
export type EmployeePayGroup = { current: EmployeePayGroupEntry | null; history: EmployeePayGroupEntry[] };

export function getEmployeePayGroup(employeeId: string): Promise<LoaderResult<EmployeePayGroup | null>> {
  return fetchJson<unknown, EmployeePayGroup | null>(`/api/v1/payroll/employees/${encodeURIComponent(employeeId)}/pay-group`, null, {
    telemetryKey: "payroll.employee.pay-group",
    mapResponse: (p) => {
      const o = p as { current?: unknown; history?: unknown } | null;
      if (!o || typeof o !== "object" || !("current" in o)) return null;
      return {
        current: (o.current as EmployeePayGroupEntry | null) ?? null,
        history: Array.isArray(o.history) ? (o.history as EmployeePayGroupEntry[]) : [],
      };
    },
  });
}

/**
 * Honest, data-derived completion for the Bootstrap Wizard.
 *
 * Each step's status is computed from real tenant data:
 *   - "complete" only when the step's defined condition is satisfied (R8.1)
 *   - "unknown" when the underlying data could not be loaded — never silently
 *     "todo" or "complete" (R8.4, R10.3)
 *   - "todo" otherwise
 *
 * The Progress Indicator counts only "complete" steps (R8.2) and reflects every
 * step including org-profile and departments (R8.5). Resumption derives status
 * from data on every visit, never from a prior-visit flag (R9.4).
 */
import { fetchJson } from "@/app/_data/apiClient";
import {
  getLocations,
  getTenantUsers,
  getTenantSettings,
  getChartOfAccounts,
  getPayrollStructures,
} from "@/app/_data/loaders";
import type { WizardStepKey, StepStatus } from "@/lib/setupSteps";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/** Tri-state from a "list has at least one row" check, honouring load errors. */
function listStatus(source: "api" | "error", count: number): StepStatus {
  if (source === "error") return "unknown";
  return count >= 1 ? "complete" : "todo";
}

/** Read a generic array endpoint, returning count + whether it loaded. */
async function countFrom(path: string, telemetryKey: string): Promise<{ source: "api" | "error"; count: number }> {
  const res = await fetchJson<unknown, unknown[]>(path, [], {
    revalidateSeconds: 30,
    telemetryKey,
    mapResponse: (p) => {
      if (Array.isArray(p)) return p;
      if (isRecord(p) && Array.isArray(p.data)) return p.data;
      if (isRecord(p) && Array.isArray(p.items)) return p.items;
      return null;
    },
  });
  return { source: res.source === "error" ? "error" : "api", count: res.data.length };
}

async function evalOrgProfile(): Promise<StepStatus> {
  // Complete when the tenant profile has a name and an address.
  const res = await fetchJson<unknown, { ok: boolean }>("/api/v1/admin/tenant", { ok: false }, {
    revalidateSeconds: 60,
    telemetryKey: "setup.org_profile",
    mapResponse: (p) => {
      const rec = isRecord(p) && isRecord(p.data) ? p.data : isRecord(p) ? p : null;
      if (!rec) return null;
      const name = typeof rec.name === "string" && rec.name.trim().length > 0;
      const address =
        (typeof rec.address === "string" && rec.address.trim().length > 0) ||
        isRecord(rec.address);
      return { ok: Boolean(name && address) };
    },
  });
  if (res.source === "error") return "unknown";
  return res.data.ok ? "complete" : "todo";
}

async function evalBranches(): Promise<StepStatus> {
  const r = await getLocations();
  return listStatus(r.source === "error" ? "error" : "api", r.data.length);
}

async function evalDepartments(): Promise<StepStatus> {
  const { source, count } = await countFrom("/api/v1/hrms/departments", "setup.departments");
  return listStatus(source, count);
}

async function evalPeople(): Promise<StepStatus> {
  const r = await getTenantUsers();
  if (r.source === "error") return "unknown";
  // More than one user means the founder has invited at least one teammate.
  return r.data.length > 1 ? "complete" : "todo";
}

async function evalModules(): Promise<StepStatus> {
  const r = await getTenantSettings();
  return listStatus(r.source === "error" ? "error" : "api", r.data.length);
}

async function evalFinanceYearCoa(): Promise<StepStatus> {
  const coa = await getChartOfAccounts();
  return listStatus(coa.source === "error" ? "error" : "api", coa.data.length);
}

async function evalLeavePolicies(): Promise<StepStatus> {
  const { source, count } = await countFrom("/api/v1/hrms/leave-policies", "setup.leave_policies");
  return listStatus(source, count);
}

async function evalPayStructure(): Promise<StepStatus> {
  const r = await getPayrollStructures();
  return listStatus(r.source === "error" ? "error" : "api", r.data.length);
}

const EVALUATORS: Record<WizardStepKey, () => Promise<StepStatus>> = {
  "org-profile": evalOrgProfile,
  branches: evalBranches,
  departments: evalDepartments,
  people: evalPeople,
  modules: evalModules,
  "finance-year-coa": evalFinanceYearCoa,
  "leave-policies": evalLeavePolicies,
  "pay-structure": evalPayStructure,
};

/** Evaluate one step's completion from real data. Never throws. */
export async function evaluateStep(key: WizardStepKey): Promise<StepStatus> {
  try {
    return await EVALUATORS[key]();
  } catch {
    return "unknown";
  }
}

/** Evaluate all given steps in parallel, returning a status map. */
export async function evaluateSteps(keys: WizardStepKey[]): Promise<Record<string, StepStatus>> {
  const entries = await Promise.all(
    keys.map(async (key) => [key, await evaluateStep(key)] as const),
  );
  return Object.fromEntries(entries);
}

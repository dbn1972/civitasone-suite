import { PageHeader, StatGrid, StatCard } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { formatMoney } from "@/lib/formatters";
import { PfmsConsole } from "./PfmsConsole";
import type { PfmsBatchRow, PfmsConfig, PfmsDepartment } from "./types";

async function getBatches(): Promise<LoaderResult<PfmsBatchRow[]>> {
  return fetchJson<unknown, PfmsBatchRow[]>("/api/v1/finance/pfms/batches", [], {
    telemetryKey: "finance.pfms.batches",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: PfmsBatchRow[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

async function getConfig(): Promise<LoaderResult<PfmsConfig | null>> {
  return fetchJson<unknown, PfmsConfig | null>("/api/v1/finance/pfms/config", null, {
    telemetryKey: "finance.pfms.config",
    mapResponse: (p) => (p && typeof p === "object" ? (p as PfmsConfig) : null),
  });
}

/**
 * Reuses the HRMS departments endpoint the same way
 * hr/employees/new/page.tsx already does — no new backend route, and no
 * touch to the shared loaders.ts (which has no existing department-list
 * loader to import).
 *
 * Known gap: GET /v1/hrms/departments is gated to HR_READ_ROLES
 * (hr_admin/hr_officer/super_admin/admin/manager) on hrms-service — it does
 * NOT include finance_officer/finance_admin/payroll_admin, the roles that
 * actually submit PFMS salary bills. Those sessions get a 403 here, which
 * this loader (like getBatches/getConfig above) turns into an empty list
 * rather than a crash; SalaryBillForm shows a "no departments available"
 * fallback in that case. Not fixed here — it's an hrms-service RBAC change
 * outside this task's scope.
 */
async function getDepartments(): Promise<LoaderResult<PfmsDepartment[]>> {
  return fetchJson<unknown, PfmsDepartment[]>("/api/v1/hrms/departments", [], {
    telemetryKey: "finance.pfms.departments",
    mapResponse: (p) => (p as { data: PfmsDepartment[] })?.data ?? null,
  });
}

export default async function PfmsOpsConsolePage() {
  const [
    { data: batches, source: batchesSource },
    { data: config, source: configSource },
    { data: departments },
  ] = await Promise.all([getBatches(), getConfig(), getDepartments()]);

  const source = batchesSource === "error" || configSource === "error" ? "error" : "api";

  const signedCount = batches.filter((b) => b.submissionStatus === "signed").length;
  const pendingCount = batches.filter((b) => b.submissionStatus === "pending").length;
  const totalMinor = batches.reduce((sum, b) => sum + BigInt(b.amountMinor || "0"), 0n);

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="PFMS Ops Console"
        subtitle="Operational console for PFMS batches, tenant configuration, salary bills, payment advices, and e-Kuber payment submission."
        back="/finance"
      />
      {source === "error" && <DataSourceBadge source="error" />}

      <StatGrid>
        <StatCard icon="📦" iconBg="#eff6ff" label="PFMS Batches" value={batches.length} />
        <StatCard icon="✍️" iconBg="#ecfdf3" label="Signed" value={signedCount} />
        <StatCard icon="⏳" iconBg="#fffbe6" label="Pending Signature" value={pendingCount} />
        <StatCard
          icon="💰"
          iconBg="#fef3f2"
          label="Total Batch Value"
          // Money formatting: amountMinor is paise (minor units) — use formatMoney,
          // not formatRupees.
          value={formatMoney(totalMinor)}
        />
      </StatGrid>

      <PfmsConsole batches={batches} config={config} departments={departments} />
    </main>
  );
}

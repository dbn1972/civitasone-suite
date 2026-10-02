import { getTranslations } from "next-intl/server";
import { PageHeader, StatGrid, StatCard } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { formatMoney, sumMinor } from "@/lib/formatters";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { PfmsConsole } from "./PfmsConsole";
import { canDownloadBankFile } from "./roles";
import { parsePfmsConfig, type PfmsBatchRow, type PfmsBill, type PfmsConfig, type PfmsDepartment } from "./types";

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
    mapResponse: parsePfmsConfig,
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

/**
 * Bills the payment-advice form can pick from (GAP-FINANCE-PFMS-07), so the
 * clerk selects a bill instead of copying a UUID from another screen. Only the
 * fields the form uses are kept; a failed/403 fetch degrades to an empty list
 * and the form falls back to its manual Bill ID field.
 */
const BILL_PAGE = 500; // the bills endpoint's maximum page size
const BILL_MAX_PAGES = 10; // 5,000 bills: a hard stop so a runaway list cannot stall the page

async function getBillsPage(offset: number): Promise<LoaderResult<PfmsBill[]>> {
  return fetchJson<unknown, PfmsBill[]>(`/api/v1/finance/bills?limit=${BILL_PAGE}&offset=${offset}`, [], {
    telemetryKey: "finance.pfms.bills",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: unknown })?.data;
      if (!Array.isArray(arr)) return null;
      const out: PfmsBill[] = [];
      for (const raw of arr) {
        if (!raw || typeof raw !== "object") continue;
        const r = raw as Record<string, unknown>;
        if (typeof r.id !== "string" || typeof r.billNo !== "string") continue;
        out.push({
          id: r.id,
          billNo: r.billNo,
          vendor: typeof r.vendor === "string" ? r.vendor : "",
          amountMinor: typeof r.amount === "string" || typeof r.amount === "number" ? String(r.amount) : "",
          status: typeof r.status === "string" ? r.status : "",
        });
      }
      return out;
    },
  });
}

/**
 * Pages through ALL bills (the endpoint defaults to 50 per call, which silently
 * hid every older payable bill) and keeps only the payable ones. A failure on a
 * later page keeps what was loaded; a failure on the first page degrades to an
 * empty list and the advice form falls back to its manual Bill ID field.
 */
async function getBills(): Promise<LoaderResult<PfmsBill[]>> {
  const all: PfmsBill[] = [];
  let first: LoaderResult<PfmsBill[]> | null = null;
  for (let page = 0; page < BILL_MAX_PAGES; page++) {
    const res = await getBillsPage(page * BILL_PAGE);
    first ??= res;
    if (res.source === "error" || !Array.isArray(res.data)) break;
    all.push(...res.data.filter((b) => b.status === "passed" || b.status === "approved"));
    if (res.data.length < BILL_PAGE) break;
  }
  return { ...(first as LoaderResult<PfmsBill[]>), data: all };
}

export default async function PfmsOpsConsolePage() {
  const t = await getTranslations("pfms");
  const [
    { data: batches, source: batchesSource },
    { data: config, source: configSource },
    { data: departments },
    { data: billsData },
  ] = await Promise.all([getBatches(), getConfig(), getDepartments(), getBills()]);
  const bills = Array.isArray(billsData) ? billsData : [];

  const source = batchesSource === "error" || configSource === "error" ? "error" : "api";

  const signedCount = batches.filter((b) => b.submissionStatus === "signed").length;
  const pendingCount = batches.filter((b) => b.submissionStatus === "pending").length;
  // One non-integer amountMinor must not throw the whole server page into its
  // error boundary (GAP-FINANCE-PFMS-04): the stat degrades to a dash instead.
  const { total: totalMinor, invalid: invalidAmounts } = sumMinor(batches.map((b) => b.amountMinor));

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/finance"
      />
      {source === "error" && <DataSourceBadge source="error" />}

      <StatGrid>
        <StatCard icon="📦" iconBg="#eff6ff" label={t("statBatches")} value={batches.length} />
        <StatCard icon="✍️" iconBg="#ecfdf3" label={t("statSigned")} value={signedCount} />
        <StatCard icon="⏳" iconBg="#fffbe6" label={t("statPendingSignature")} value={pendingCount} />
        <StatCard
          icon="💰"
          iconBg="#fef3f2"
          label={t("statTotalBatchValue")}
          // Money formatting: amountMinor is paise (minor units) — use formatMoney,
          // not formatRupees.
          value={invalidAmounts > 0 ? "—" : formatMoney(totalMinor)}
        />
      </StatGrid>
      {invalidAmounts > 0 && (
        <p role="note" style={{ margin: "0 0 12px", color: "var(--ink2)", fontSize: 13 }}>
          {t("unreadableAmounts", { count: invalidAmounts })}
        </p>
      )}

      <PfmsConsole batches={batches} config={config} departments={departments} bills={bills} canDownloadBankFile={canDownloadBankFile(getSessionRoles())} />
    </div>
  );
}

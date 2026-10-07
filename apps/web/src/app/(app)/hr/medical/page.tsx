import Link from "next/link";
import { PageHeader, StatGrid, StatCard, Card, RefreshErrorState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { getTranslations } from "next-intl/server";
import { toHumanError } from "@/lib/messages";
import { formatIndianDate } from "@/lib/formatters";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { mapEmployeeOptions } from "@/lib/entityAdapters/employee";
import type { EntityOption } from "@/app/_components/ds";
import { MedicalClaimsTable, type MedicalClaimRow } from "./MedicalClaimsTable";

// Mirrors medical/routes.ts's HR_ROLES for the approve/reject PATCH route.
const HR_ROLES = ["hr_admin", "hr_officer", "super_admin", "finance_officer"];

type ApiRow = {
  id: string;
  claim_no: number | null;
  employee_id: string;
  claim_type: string;
  amount_minor: string;
  hospital_name?: string;
  diagnosis?: string;
  status: string;
  dependant_name?: string;
  dependant_relation?: string;
  approved_amount_minor?: string;
  created_at: string;
} & Record<string, unknown>;

async function getData(): Promise<LoaderResult<ApiRow[]>> {
  return fetchJson<unknown, ApiRow[]>("/api/v1/hrms/medical/claims", [], {
    telemetryKey: "hr.medical",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: ApiRow[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

export default async function MedicalPage() {
  const t = await getTranslations("medicalClaims");
  const roles = getSessionRoles();
  // GAP-HR-MEDICAL-05: approve/reject is only ever meaningful for the same
  // HR_ROLES the backend's own PATCH .../approve route requires — computed
  // here (a Server Component, with real session data) and passed down as a
  // plain boolean, since the client table/actions components below have no
  // session access of their own.
  const canApprove = roles.some((r) => HR_ROLES.includes(r));

  const { data: apiRows, source } = await getData();
  const errored = source === "error";

  // GAP-HR-MEDICAL-02 (PII/identity): employee_id was already in the API
  // response but dropped before rendering, so an HR reader couldn't tell
  // whose claim a row was. Batch-resolve names via the same adapter
  // EntityPicker uses (GAP-HR-SF-06) — one call for every unique id on the
  // page, not N+1 — since medical/routes.ts cannot itself JOIN
  // employee.hrms_employees (module isolation, CLAUDE.md rule 4).
  const employeeIds = [...new Set(apiRows.map((r) => r.employee_id).filter(Boolean))];
  // This is a Server Component: resolveEmployees() (the browser adapter) fetches the relative
  // URL `/api/proxy/...`, which throws "Failed to parse URL" on the server and crashed the whole
  // page whenever at least one claim existed. Use the server fetch client instead.
  const employees: EntityOption[] =
    employeeIds.length > 0
      ? (
          await fetchJson<unknown, EntityOption[]>(
            `/api/v1/hrms/employees?ids=${employeeIds.map(encodeURIComponent).join(",")}`,
            [],
            { telemetryKey: "hr.medical.employees", mapResponse: mapEmployeeOptions },
          )
        ).data
      : [];
  const employeeById = new Map(employees.map((e) => [e.id, e]));

  const items: MedicalClaimRow[] = apiRows.map((r) => {
    const amountNum = r.amount_minor != null ? Number(r.amount_minor) : null;
    const approvedNum = r.approved_amount_minor != null ? Number(r.approved_amount_minor) : null;
    const employee = employeeById.get(r.employee_id);
    return {
      id: r.id,
      // GAP-HR-MEDICAL-04 (UUID): claim_no is now the real, DB-guaranteed-
      // unique column (migration 0156), not a client-side slice of the
      // row's opaque uuid, which could (and eventually would) collide.
      caseRef: r.claim_no != null ? `MED-${String(r.claim_no).padStart(6, "0")}` : "—",
      employeeId: r.employee_id,
      employeeLabel: employee?.label ?? "—",
      claimType: r.claim_type,
      hospital: r.hospital_name ?? "—",
      amount: amountNum != null && Number.isFinite(amountNum) ? amountNum : null,
      approvedAmount: approvedNum != null && Number.isFinite(approvedNum) ? approvedNum : null,
      claimantType: r.dependant_name ? t("claimantDependant", { relation: r.dependant_relation ?? "" }) : t("claimantSelf"),
      filedDate: formatIndianDate(r.created_at ? r.created_at.slice(0, 10) : null),
      status: r.status,
      actions: "",
    };
  });

  const pending = items.filter((i) => i.status === "pending").length;
  // GAP-HR-MEDICAL-03: schema status enum is pending|approved|rejected|
  // settled — "paid" is never produced by the backend, so it never
  // contributed to this tile, and "settled" (paid out) claims were counted
  // in no tile at all.
  const approved = items.filter((i) => i.status === "approved" || i.status === "settled").length;
  const rejected = items.filter((i) => i.status === "rejected").length;

  return (
    <div className="page-main wrap">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr"
        backLabel={t("backToHr")}
        // GAP-HR-MEDICAL-05/06: was an empty <span/> (dead markup) despite
        // POST /medical/claims already existing on the backend with no UI
        // anywhere in the app calling it.
        actions={<Link href="/hr/medical/new" className="btn primary">{t("fileClaimAction")}</Link>}
      />
      <DataSourceBadge source={source} message={t("dataSourceErrorMessage")} />
      <StatGrid>
        <StatCard icon="🏥" iconBg="var(--infobg, #e6f0ff)" label={t("statTotalLabel")} value={errored ? null : items.length} />
        <StatCard icon="⏳" iconBg="var(--warnbg, #fffbe6)" label={t("statPendingLabel")} value={errored ? null : pending} />
        <StatCard icon="✅" iconBg="var(--goodbg, #e6f7f0)" label={t("statApprovedLabel")} value={errored ? null : approved} />
        <StatCard icon="🔴" iconBg="var(--badbg, #fff1f0)" label={t("statRejectedLabel")} value={errored ? null : rejected} />
      </StatGrid>
      <Card title={t("cardTitle")}>
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "medical claims" })} backHref="/hr" />
          </div>
        ) : (
          <MedicalClaimsTable rows={items} canApprove={canApprove} />
        )}
      </Card>
    </div>
  );
}

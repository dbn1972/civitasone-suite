import { PageHeader, StatGrid, StatCard, Card, RefreshErrorState } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { PermissionDenied } from "../../../../_components/PermissionDenied";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { getMyProfile } from "@/app/_data/loaders";
import { resolveEmployeeNames, employeeDisplayLabel } from "@/app/_data/employeeNames";
import { formatMoney, formatIndianDate, formatPeriod } from "@/lib/formatters";
import { getSessionRoles, PAYROLL_ADMIN_ROLES } from "@/lib/auth/roleGuard";
import { reimbursementCategoryKey } from "@/lib/payroll/reimbursementCategories";
import { CreateReimbursementForm, type ClaimSubject } from "./CreateReimbursementForm";
import { ReimbursementsTable, type ClaimRow } from "./ReimbursementsTable";
import { toHumanError } from "@/lib/messages";
import { getTranslations } from "next-intl/server";

type Row = {
  id: string;
  employee_id: string;
  category: string;
  amount_minor: number | string;
  bill_date: string | null;
  bill_ref: string | null;
  period: string;
  status: string;
} & Record<string, unknown>;

/**
 * GAP-PAYROLL-REIMBURSEMENTS-05: mirrors payroll-service world-class-routes.ts.
 * Staff (`ROLES` there: payroll_admin/officer, super_admin, hr_admin) list
 * every claim, file on anyone's behalf and approve/reject. A self-service
 * employee lists only their OWN claims (the server pins the list to the
 * caller's employee id) and files only for themselves. Anyone else gets a
 * 403 from the API, so they get an explanation instead of a failed fetch.
 */
// Must equal world-class-routes.ts ROLES exactly: the server pins anyone
// WITHOUT one of these roles (e.g. finance_officer+employee) to their own
// claims, so the page treats exactly the same set as staff.
const REIMBURSEMENT_STAFF_ROLES = [...PAYROLL_ADMIN_ROLES, "hr_admin"];

async function getData(): Promise<LoaderResult<Row[]>> {
  return fetchJson<unknown, Row[]>("/api/v1/payroll/reimbursements", [], {
    telemetryKey: "payroll.reimbursements",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: Row[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

export default async function ReimbursementsPage() {
  const t = await getTranslations("payrollReimbursements");
  const tCat = await getTranslations("createReimbursementForm");
  const roles = getSessionRoles();
  const isStaff = roles.some((r) => REIMBURSEMENT_STAFF_ROLES.includes(r));
  const isSelfService = !isStaff && roles.includes("employee");

  const header = (
    <PageHeader
      title={t("title")}
      subtitle={isStaff ? t("subtitle") : t("subtitleSelf")}
      back="/hr/payroll" backLabel={t("backLabel")}
    />
  );

  if (!isStaff && !isSelfService) {
    return (
      <div className="page-main wrap" aria-labelledby="page-heading">
        {header}
        <PermissionDenied module="reimbursements" requiredRoles={[...REIMBURSEMENT_STAFF_ROLES, "employee"]} backHref="/hr/payroll" backLabel={t("backLabel")} />
      </div>
    );
  }

  const [{ data: items, source }, profile] = await Promise.all([
    getData(),
    isSelfService ? getMyProfile() : Promise.resolve(null),
  ]);
  const errored = source === "error";

  // GAP-PAYROLL-REIMBURSEMENTS-01: who the form files for. A self-service
  // user with no linked employee record cannot file at all.
  let subject: ClaimSubject | null = { mode: "admin" };
  if (isSelfService) {
    const me = profile?.data;
    subject = me && me.id ? { mode: "self", employeeId: me.id, label: me.employeeNo ? `${me.name} (${me.employeeNo})` : me.name } : null;
  }

  // GAP-PAYROLL-REIMBURSEMENTS-01: names, not UUIDs (staff view; a
  // self-service list is only ever the caller's own claims).
  const names = isStaff ? await resolveEmployeeNames(items.map((r) => r.employee_id)) : new Map();
  const rows: ClaimRow[] = items.map((r) => {
    const catKey = reimbursementCategoryKey(r.category);
    return {
      id: r.id,
      employee_label: employeeDisplayLabel(names, r.employee_id, t("unknownEmployee")),
      // GAP-PAYROLL-REIMBURSEMENTS-04: translated label, not the raw code.
      category_label: catKey ? tCat(catKey) : r.category,
      amount_minor: String(r.amount_minor ?? 0),
      period_display: formatPeriod(r.period),
      bill_date_display: formatIndianDate(r.bill_date),
      bill_ref: r.bill_ref?.trim() ? r.bill_ref : "—",
      status: r.status,
    };
  });

  // GAP-PAYROLL-REIMBURSEMENTS-02: rejected claims are not "claimed" money.
  const totalMinor = items
    .filter((r) => r.status !== "rejected")
    .reduce((sum, r) => sum + BigInt(String(r.amount_minor ?? 0)), 0n);
  const pendingCount = items.filter((r) => r.status === "submitted").length;
  const approvedReimb = items.filter((r) => r.status === "approved").length;

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      {header}
      <DataSourceBadge source={source} message={t("loadErrorMessage")} />
      <StatGrid>
        <StatCard icon="🧾" iconBg="var(--infobg)" label={t("statTotal")} value={errored ? null : items.length} />
        <StatCard icon="⏳" iconBg="var(--warnbg)" label={t("statPending")} value={errored ? null : pendingCount} />
        <StatCard icon="💰" iconBg="var(--goodbg)" label={t("statClaimedExcludingRejected")} value={errored ? null : formatMoney(totalMinor)} />
        <StatCard icon="✅" iconBg="var(--goodbg)" label={t("statApproved")} value={errored ? null : approvedReimb} />
      </StatGrid>

      {subject ? (
        <CreateReimbursementForm subject={subject} />
      ) : (
        <Card title={t("noProfileTitle")} padding>
          <p style={{ fontSize: 13, color: "var(--ink2)", margin: 0 }}>{t("noProfileMessage")}</p>
        </Card>
      )}

      <Card title={t("cardTitle")}>
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "reimbursements" })} backHref="/hr/payroll" />
          </div>
        ) : (
          <ReimbursementsTable rows={rows} canDecide={isStaff} showEmployee={isStaff} />
        )}
      </Card>
    </div>
  );
}

import { PageHeader, Card, EmptyState, LoadErrorState, Button } from "../../../../../_components/ds";
import { PermissionDenied } from "../../../../../_components/PermissionDenied";
import { formatPeriod, todayIST } from "@/lib/formatters";
import { getSessionRoles, PAYROLL_ADMIN_ROLES, PAYROLL_READER_ROLES } from "@/lib/auth/roleGuard";
import { getTranslations } from "next-intl/server";
import { Pager } from "../Pager";
import { UnassignedTable } from "../UnassignedTable";
import { getActiveGroups, getUnassigned } from "../payGroupData";
import { MEMBERS_PAGE_SIZE, hasNoRows, parseOffset, resolveMonth } from "../payGroupMembership";

export default async function UnassignedPayGroupReportPage({
  searchParams,
}: {
  searchParams?: { month?: string; offset?: string };
}) {
  const t = await getTranslations("payGroupUnassigned");

  const roles = getSessionRoles();
  if (!roles.some((r) => PAYROLL_READER_ROLES.includes(r))) {
    return (
      <div className="page-main wrap">
        <PermissionDenied module="pay groups" requiredRoles={PAYROLL_READER_ROLES} backHref="/hr/payroll/pay-groups" backLabel={t("backLabel")} />
      </div>
    );
  }
  const canAdminister = roles.some((r) => PAYROLL_ADMIN_ROLES.includes(r));
  const month = resolveMonth(searchParams?.month, todayIST().slice(0, 7));
  const offset = parseOffset(searchParams?.offset);

  const [result, groupsResult] = await Promise.all([
    getUnassigned(month, MEMBERS_PAGE_SIZE, offset),
    canAdminister ? getActiveGroups() : Promise.resolve({ data: [], source: "api" as const }),
  ]);
  const errored = result.source === "error";
  const { data: rows, total } = result.data;

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title={t("title")} subtitle={t("subtitle")} back="/hr/payroll/pay-groups" backLabel={t("backLabel")} />

      <form method="get" style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 16 }}>
        <div style={{ display: "grid", gap: 6 }}>
          <label htmlFor="unassigned-month" style={{ fontSize: 13, fontWeight: 600 }}>{t("monthLabel")}</label>
          <input
            id="unassigned-month"
            name="month"
            type="month"
            defaultValue={month}
            style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
          />
        </div>
        <Button type="submit" style={{ minHeight: 44 }}>{t("applyBtn")}</Button>
      </form>

      <Card title={t("cardTitle", { month: formatPeriod(month) })} padding>
        {errored ? (
          <LoadErrorState result={result} area={t("loadArea")} backHref="/hr/payroll/pay-groups" backLabel={t("backLabel")} />
        ) : hasNoRows(rows) ? (
          <EmptyState icon="✅" title={t("emptyTitle")} message={t("emptyMessage", { month: formatPeriod(month) })} />
        ) : (
          <>
            <p role="status" style={{ marginTop: 0 }}>{t("countSummary", { count: total })}</p>
            {canAdminister && groupsResult.source === "error" && (
              <p role="status" className="pill warn" style={{ width: "fit-content" }}>{t("groupsLoadWarning")}</p>
            )}
            <UnassignedTable rows={rows} groups={groupsResult.data} canAdminister={canAdminister} defaultDate={`${month}-01`} />
            <Pager
              total={total}
              limit={MEMBERS_PAGE_SIZE}
              offset={offset}
              hrefFor={(o) => `/hr/payroll/pay-groups/unassigned?month=${month}${o > 0 ? `&offset=${o}` : ""}`}
            />
          </>
        )}
      </Card>
    </div>
  );
}

import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PageHeader, Card, DataTable, EmptyState, RefreshErrorState } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { PermissionDenied } from "../../../../_components/PermissionDenied";
import { getMySlips } from "../../../../_data/loaders";
import { getSessionRoles, PAYROLL_READER_ROLES } from "@/lib/auth/roleGuard";
import { toHumanError } from "@/lib/messages";
import type { SalarySlipSummary } from "@civitasone/types";

const PAGE_SIZE = 24;
/** Mirrors payroll-service SLIP_ROLES for GET /v1/payroll/slips/mine (payroll readers + employee). */
const MY_SLIPS_ROLES = [...PAYROLL_READER_ROLES, "employee"];

type Row = SalarySlipSummary & Record<string, unknown>;

/**
 * GAP-PAYROLL-SALARY-SLIPS-04: "My payslips". Lists ONLY the signed-in
 * employee's slips (the server derives the employee from the token), without
 * org-wide totals. Each row opens the existing slip detail, which already
 * admits the owning employee.
 */
export default async function MySlipsPage({ searchParams }: { searchParams?: { page?: string } }) {
  const t = await getTranslations("mySlips");
  const roles = getSessionRoles();
  if (!roles.some((r) => MY_SLIPS_ROLES.includes(r))) {
    return <PermissionDenied module="my payslips" requiredRoles={MY_SLIPS_ROLES} />;
  }
  const page = Math.max(1, Math.min(500, Number.parseInt(searchParams?.page ?? "1", 10) || 1));
  const { data: slips, source } = await getMySlips(PAGE_SIZE, (page - 1) * PAGE_SIZE);
  const errored = source === "error";
  const hasNext = slips.length === PAGE_SIZE;

  const columns: { key: keyof Row & string; label: string; align?: "left" | "right"; cellType?: "status" | "amount" }[] = [
    { key: "payPeriod", label: t("colPeriod") },
    { key: "gross", label: t("colGross"), align: "right", cellType: "amount" },
    { key: "deductions", label: t("colDeductions"), align: "right", cellType: "amount" },
    { key: "net", label: t("colNet"), align: "right", cellType: "amount" },
    { key: "status", label: t("colStatus"), cellType: "status" },
  ];

  return (
    <div className="page-main wrap">
      <PageHeader title={t("title")} subtitle={t("subtitle")} back="/hr" backLabel={t("backLabel")} />
      <DataSourceBadge source={source} message={t("loadErrorMessage")} />
      <Card title={t("cardTitle")}>
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "my payslips" })} backHref="/hr" />
          </div>
        ) : slips.length === 0 && page === 1 ? (
          <EmptyState icon="📄" title={t("emptyTitle")} message={t("emptyMessage")} />
        ) : (
          <>
            <DataTable<Row>
              columns={columns}
              rows={slips as Row[]}
              rowLinkPrefix="/hr/payroll/salary-slips/"
              rowLinkKey="id"
              pageSize={PAGE_SIZE}
              emptyTitle={t("emptyTitle")}
              emptyMessage={t("emptyMessage")}
            />
            <nav aria-label={t("pagerLabel")} style={{ display: "flex", gap: 12, padding: "12px 16px", justifyContent: "space-between" }}>
              {page > 1 ? <Link href={`/hr/payroll/my-slips?page=${page - 1}`}>{t("newer")}</Link> : <span />}
              {hasNext ? <Link href={`/hr/payroll/my-slips?page=${page + 1}`}>{t("older")}</Link> : <span />}
            </nav>
          </>
        )}
      </Card>
    </div>
  );
}

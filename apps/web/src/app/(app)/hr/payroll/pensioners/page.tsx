import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { PermissionDenied } from "../../../../_components/PermissionDenied";
import { PageHeader, StatGrid, StatCard, Card, DataTable, EmptyState, RefreshErrorState } from "../../../../_components/ds";
import { getPensioners } from "../../../../_data/loaders";
import { formatMoney } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";
import { getSessionRoles, PAYROLL_ADMIN_ROLES, PAYROLL_READER_ROLES } from "../../../../../lib/auth/roleGuard";
import type { PensionerSummary } from "@civitasone/types";

type Row = PensionerSummary;
type DisplayRow = Row & { basicPensionDisplay: string };

// GAP-PAYROLL-PENSIONERS-05: the view/create role lists used to be
// duplicated here and in new/page.tsx. Both now come from roleGuard's shared
// payroll constants, which mirror payroll-service's own READER_ROLES (GET
// /v1/payroll/pensioners) and PAYROLL_ROLES (POST) in payroll/routes.ts.
// The "Add Pensioner" button uses the narrower create list so a viewer who
// cannot create never sees a button that would land on PermissionDenied.

// Named page-level constants (PENSIONER_VIEW_ROLES / PENSIONER_CREATE_ROLES)
// built from roleGuard's shared payroll lists via a RELATIVE import: the
// static web-vs-backend analyzer (scripts/contract/hr-role-matrix.mjs) looks
// these names up in this file and only follows relative imports, so an
// "@/..." alias import made both gates resolve to [] (a false DRIFT after
// #1760). Values are unchanged: they mirror payroll-service READER_ROLES /
// PAYROLL_ROLES for GET / POST /v1/payroll/pensioners.
const PENSIONER_VIEW_ROLES = [...PAYROLL_READER_ROLES];
const PENSIONER_CREATE_ROLES = [...PAYROLL_ADMIN_ROLES];

export default async function PensionersPage() {
  const t = await getTranslations("pensioners");
  const roles = getSessionRoles();
  if (!roles.some((r) => PENSIONER_VIEW_ROLES.includes(r))) {
    return <PermissionDenied module="pensioners" requiredRoles={PENSIONER_VIEW_ROLES} />;
  }
  const canCreate = roles.some((r) => PENSIONER_CREATE_ROLES.includes(r));
  const { data: pensioners, source } = await getPensioners();
  // GAP-PAYROLL-PENSIONERS-01: getPensioners() falls back to [] on failure,
  // which used to render 0 / ₹0.00 stats and a "no records match your
  // filter" table -- a silent all-zero dashboard. Gate every figure on it.
  const errored = source === "error";

  const total = pensioners.length;
  const active = pensioners.filter((p) => p.status === "active").length;
  // GAP-PAYROLL-PENSIONERS-02: this is the sum of BASIC pension of active
  // pensioners only -- no DA/dearness relief, medical allowance or
  // commutation recovery -- so it is labelled as such, not as "payable".
  // Summed in BigInt so a large register never loses paise to float error.
  const activeBasicPensionMinor = pensioners
    .filter((p) => p.status === "active")
    .reduce((sum, p) => sum + BigInt(Math.round(Number(p.basicPensionMinor) || 0)), 0n);
  const inactivePensioners = pensioners.filter((p) => p.status !== "active").length;
  const registerIsEmpty = pensioners.length === 0; // ux-001-ok: only rendered under !errored

  // Server-safe: DataTable's `render` prop cannot cross the server/client
  // boundary (this is an async Server Component), so pre-format the display
  // amount into a plain string field instead.
  const rows: DisplayRow[] = pensioners.map((p) => ({ ...p, basicPensionDisplay: formatMoney(p.basicPensionMinor) }));

  const columns: { key: keyof DisplayRow & string; label: string; align?: "left" | "right"; cellType?: "status" }[] = [
    { key: "ppoNo", label: t("colPpoNo") },
    { key: "fullName", label: t("colName") },
    { key: "basicPensionDisplay", label: t("colBasicPension"), align: "right" },
    { key: "status", label: t("colStatus"), cellType: "status" },
    { key: "ddoCode", label: t("colDdoCode") },
  ];

  // GAP-PAYROLL-PENSIONERS-03: a register with no pensioners at all gets its
  // own honest empty copy (EmptyState below); DataTable's emptyMessage is now
  // only the filtered-no-match case.
  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr/payroll" backLabel="Back to Payroll"
        actions={
          canCreate ? (
            <Link href="/hr/payroll/pensioners/new" className="btn primary">{t("addPensionerLink")}</Link>
          ) : undefined
        }
      />
      <DataSourceBadge source={source} message={t("loadErrorMessage")} />
      {/* GAP-PAYROLL-PENSIONERS-04: PPO number, full name, DDO code and pension
          amount are personal data (DPDP Act 2023). State the purpose limit. */}
      <p role="note" className="sub" style={{ margin: "0 0 12px", fontSize: 12, color: "var(--mut)" }}>{t("dataUseNotice")}</p>
      <StatGrid>
        <StatCard icon="👴" iconBg="var(--panel)" label={t("statTotalPensioners")} value={errored ? null : total} />
        <StatCard icon="✅" iconBg="var(--goodbg)" label={t("statActive")} value={errored ? null : active} />
        <StatCard icon="💰" iconBg="var(--warnbg)" label={t("statActiveBasicPension")} value={errored ? null : formatMoney(activeBasicPensionMinor)} />
        <StatCard icon="🚫" iconBg="var(--badbg)" label={t("statInactive")} value={errored ? null : inactivePensioners} />
      </StatGrid>
      <p className="sub" style={{ margin: "4px 0 12px", fontSize: 12, color: "var(--mut)" }}>{t("statActiveBasicPensionNote")}</p>
      <Card title={t("recordsCardTitle")}>
        {errored && (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: t("loadErrorArea") })} backHref="/hr/payroll" />
          </div>
        )}
        {!errored && registerIsEmpty && (
          <EmptyState icon="👴" title={t("emptyRegisterTitle")} message={t("emptyRegisterMessage")} />
        )}
        {!errored && !registerIsEmpty && (
          <DataTable<DisplayRow>
            columns={columns}
            rows={rows}
            sortable
            filterable
            filterPlaceholder={t("filterPlaceholder")}
            pageSize={15}
            emptyIcon="👴"
            emptyTitle={t("emptyTitle")}
            emptyMessage={t("emptyMessage")}
          />
        )}
      </Card>
    </div>
  );
}

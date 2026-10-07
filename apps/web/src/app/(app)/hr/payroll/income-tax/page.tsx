import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { PageHeader, StatGrid, StatCard, Card, RefreshErrorState } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { PermissionDenied } from "../../../../_components/PermissionDenied";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { toHumanError } from "@/lib/messages";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { PAYROLL_TAX_READER_ROLES } from "@/lib/auth/workRoles";
import { IncomeTaxTable } from "./IncomeTaxTable";

type Row = {
  id: string;
  employee: string;
  department: string;
  grossIncome: string;
  deductions80C: string;
  otherDeductions: string;
  taxableIncome: string;
  taxPayable: string;
  status: string;
} & Record<string, unknown>;

async function getData(): Promise<LoaderResult<Row[]>> {
  const r = await fetchJson<unknown, Row[]>("/api/v1/payroll/income-tax", [], {
    telemetryKey: "payroll.income-tax",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: Row[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
  return r;
}

export default async function IncomeTaxPage() {
  const t = await getTranslations("incomeTax");

  // GAP-PAYROLL-INCOME-TAX-02: hr/layout.tsx deliberately admits "manager"
  // and "employee" to every /hr/payroll/* URL (self-service lives inside
  // this same tree -- see that layout's own doc comment), so this page adds
  // its own tighter gate, the way hr/payroll/page.tsx already does for its
  // own admin-only sections. PAYROLL_TAX_READER_ROLES mirrors payroll-
  // service's tax/routes.ts READER_ROLES exactly (verified against that
  // file): "manager" is not in it (gets a flat backend 403 today) and
  // "employee" IS, because the backend already scopes an employee caller to
  // their own single row regardless of this page-level gate -- there is no
  // tenant-wide DPDP exposure to close here, only a confusing 403/blank page
  // for "manager" and a single-row "list" for "employee" that this gate
  // replaces with a clear, purpose-built message.
  const roles = getSessionRoles();
  if (!roles.some((r) => PAYROLL_TAX_READER_ROLES.includes(r))) {
    return <PermissionDenied module="income tax" requiredRoles={PAYROLL_TAX_READER_ROLES} backHref="/hr/payroll" backLabel={t("errorBackLabel")} />;
  }

  const { data: items, source } = await getData();
  const errored = source === "error";

  // GAP-PAYROLL-INCOME-TAX-04: traced against payroll-service's actual
  // tax/consumer.ts -- a real declaration's status is always written as
  // "submitted" (never "finalized"/"completed", which this stat used to
  // match instead); "pending" is the GET route's own literal default for an
  // employee with no declaration on file for the FY at all. "draft" was the
  // schema column's own default, tolerated here too in case a row is ever
  // inserted outside today's one write path. With this corrected match,
  // Finalized + Pending now actually sum to Total for every status the
  // backend can currently produce.
  const finalizedCount = errored ? null : items.filter((i) => i.status === "submitted" || i.status === "finalized" || i.status === "completed").length;
  const pendingCount = errored ? null : items.filter((i) => i.status === "pending" || i.status === "draft").length;

  return (
    <div className="page-main wrap">
      {/* GAP-PAYROLL-INCOME-TAX-06: unified on /hr/payroll (where the page
          header's own "Back to Payroll" link and RefreshErrorState below
          already went) instead of the header's previous "Back to HR" --
          error.tsx's "Back to Payroll"/t("errorBackLabel") pairing is now
          what all three back targets on this page agree on. The "File tax
          declaration" action link (added in #1744) is kept as-is. */}
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr/payroll"
        backLabel={t("errorBackLabel")}
        actions={<Link href="/hr/payroll/tax-declaration">{t("fileDeclarationLink")}</Link>}
      />
      <DataSourceBadge source={source} message={t("loadErrorMessage")} />
      <StatGrid>
        <StatCard icon="📋" iconBg="var(--infobg)" label={t("statTotal")} value={errored ? null : items.length} />
        <StatCard icon="✅" iconBg="var(--goodbg)" label={t("statFinalized")} value={finalizedCount} />
        <StatCard icon="⏳" iconBg="var(--warnbg)" label={t("statPending")} value={pendingCount} />
        <StatCard icon="🏢" iconBg="var(--panel)" label={t("statDepartments")} value={errored ? null : new Set(items.map((i) => i.department)).size} />
      </StatGrid>
      <Card title={t("cardTitle")}>
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "income tax" })} backHref="/hr/payroll" />
          </div>
        ) : (
          <IncomeTaxTable items={items} />
        )}
      </Card>
    </div>
  );
}

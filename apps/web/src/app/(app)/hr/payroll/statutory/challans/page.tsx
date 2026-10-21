import { getTranslations } from "next-intl/server";
import { PageHeader, StatGrid, StatCard, Card, DataTable, RefreshErrorState } from "../../../../../_components/ds";
import { DataSourceBadge } from "../../../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { formatMoney } from "@/lib/formatters";
import { PeriodSelector } from "./PeriodSelector";
import { IngestChallanForm } from "./IngestChallanForm";
import { toHumanError } from "@/lib/messages";
import { PermissionDenied } from "../../../../../_components/PermissionDenied";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { PAYROLL_STATUTORY_ADMIN_ROLES } from "@/lib/auth/workRoles";

type ChallanRow = {
  cin: string;
  /** GAP-PAYROLL-STATUTORY-CHALLANS-04: "24Q" | "26Q"; absent from an older payroll-service (filled from the selected form below). */
  formType?: string;
  bsrCode: string;
  challanSerial: string;
  depositDate: string;
  section: string;
  tdsAmountMinor: string;
  totalAmountMinor: string;
  status: string;
} & Record<string, unknown>;

type ChallansResponse = { period: string; formType: string; count: number; challans: ChallanRow[] };

type ReconcilePeriod = {
  period: string;
  formType: string;
  tdsDeductedMinor: string;
  tdsDepositedMinor: string;
  varianceMinor: string;
  matched: boolean;
  challanCount: number;
  status: string;
};
type ReconcileResponse = {
  formType: string;
  period?: string;
  perPeriod: ReconcilePeriod[];
  totalDeductedMinor: string;
  totalDepositedMinor: string;
  varianceMinor: string;
  matched: boolean;
  filingBlocked: boolean;
  note: string;
};

function currentPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

async function getChallans(period: string, formType: string): Promise<LoaderResult<ChallanRow[]>> {
  return fetchJson<ChallansResponse, ChallanRow[]>(
    `/api/v1/payroll/statutory/challans?period=${encodeURIComponent(period)}&formType=${encodeURIComponent(formType)}`,
    [],
    {
      telemetryKey: "payroll.statutory.challans",
      mapResponse: (p) => (Array.isArray(p?.challans) ? p.challans : null),
    },
  );
}

async function getReconciliation(period: string, formType: string): Promise<LoaderResult<ReconcileResponse | null>> {
  return fetchJson<ReconcileResponse, ReconcileResponse | null>(
    `/api/v1/payroll/statutory/reconcile?period=${encodeURIComponent(period)}&formType=${encodeURIComponent(formType)}`,
    null,
    {
      telemetryKey: "payroll.statutory.reconcile",
      mapResponse: (p) => (p && Array.isArray(p.perPeriod) ? p : null),
    },
  );
}

export default async function ChallansPage({ searchParams }: { searchParams?: { period?: string; formType?: string } }) {
  const t = await getTranslations("challans");
  // GAP-PAYROLL-STATUTORY-CHALLANS-01: hr/layout.tsx admits employee/manager to every /hr/payroll/*
  // URL, but this page's API (TDS challans) is READER_ROLES-only in
  // payroll-service (no employee/manager). Gate before fetching so those
  // roles get a clear explanation instead of a failed load.
  const roles = getSessionRoles();
  if (!roles.some((r) => PAYROLL_STATUTORY_ADMIN_ROLES.includes(r))) {
    return <PermissionDenied module="TDS challans" requiredRoles={PAYROLL_STATUTORY_ADMIN_ROLES} backHref="/hr/payroll/statutory" backLabel={t("errorBackLabel")} />;
  }
  const period = searchParams?.period && /^\d{4}-\d{2}$/.test(searchParams.period) ? searchParams.period : currentPeriod();
  // GAP-PAYROLL-STATUTORY-CHALLANS-04: default to 24Q, matching the
  // backend's own default for an absent/unrecognised formType (see
  // challan-routes.ts: `formType === "26Q" ? "26Q" : "24Q"`).
  const formType = searchParams?.formType === "26Q" ? "26Q" : "24Q";

  const [{ data: challans, source: challansSource }, { data: reconciliation, source: reconcileSource }] = await Promise.all([
    getChallans(period, formType),
    getReconciliation(period, formType),
  ]);

  const source = challansSource === "error" || reconcileSource === "error" ? "error" : "api";

  const errored = source === "error";

  // GAP-PAYROLL-STATUTORY-CHALLANS-06: reconcile status is a closed enum in
  // payroll-service (challan-routes.ts Reconciliation["status"]); show a
  // translated label instead of the raw identifier.
  const RECONCILE_STATUS_KEY: Record<string, "reconcileMatched" | "reconcileShortfall" | "reconcileExcess" | "reconcileNoChallan" | "reconcilePendingFinalisation"> = {
    matched: "reconcileMatched",
    shortfall: "reconcileShortfall",
    excess: "reconcileExcess",
    no_challan: "reconcileNoChallan",
    pending_finalisation: "reconcilePendingFinalisation",
  };

  // GAP-PAYROLL-STATUTORY-CHALLANS-03: ONE verdict drives the Reconciliation
  // Status tile's text AND its icon (they used to read two different
  // variables -- perPeriod[0].status for the text, the top-level `matched` for
  // the icon -- so a payload where they disagreed showed green "Matched" text
  // next to a warning icon). The period is reconciled only when the top-level
  // flag AND every per-period row say so; any other state is "not reconciled"
  // and shows the first period that is NOT matched (the one blocking the
  // filing), else a generic "Not matched".
  const periodRows = reconciliation?.perPeriod ?? [];
  const reconciled: boolean | null = reconciliation
    ? reconciliation.matched === true && periodRows.length > 0 && periodRows.every((p) => p.status === "matched")
    : null;
  const blockingStatus = periodRows.find((p) => p.status !== "matched")?.status ?? null;
  const reconcileStatusLabel = reconciled === null
    ? t("unknownStatus")
    : reconciled
      ? t("reconcileMatched")
      : blockingStatus && RECONCILE_STATUS_KEY[blockingStatus]
        ? t(RECONCILE_STATUS_KEY[blockingStatus])
        : t("reconcileNotMatched");

  // Each row names its form (24Q/26Q); an older payroll-service omits the field, in which case
  // the list was already filtered to the selected form so that is the row's form.
  const rows: ChallanRow[] = challans.map((c) => ({ ...c, formType: c.formType ?? formType }));

  const columns: { key: keyof ChallanRow & string; label: string; align?: "left" | "right"; cellType?: "amount" | "status" | "date" }[] = [
    { key: "cin", label: t("colCin") },
    { key: "formType", label: t("colFormType") },
    { key: "bsrCode", label: t("colBsrCode") },
    { key: "challanSerial", label: t("colSerial") },
    { key: "depositDate", label: t("colDepositDate"), cellType: "date" },
    { key: "section", label: t("colSection") },
    { key: "tdsAmountMinor", label: t("colTdsAmount"), align: "right", cellType: "amount" },
    { key: "totalAmountMinor", label: t("colTotalAmount"), align: "right", cellType: "amount" },
    { key: "status", label: t("colStatus"), cellType: "status" },
  ];

  return (
    <div className="page-main wrap">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr/payroll/statutory" backLabel={t("errorBackLabel")}
      />
      <DataSourceBadge source={source === "error" ? "error" : "api"} message={t("loadErrorMessage")} />

      <PeriodSelector period={period} formType={formType} />

      {/* GAP-PAYROLL-STATUTORY-CHALLANS-03: reconciliation.filingBlocked was
          already returned by the backend but never rendered. The gate itself
          exists server-side (buildForm24Q in statutory-returns/routes.ts).
          The backend's own `note` is NOT shown: it is English-only and always
          says "24Q" and "does not match", even for 26Q or a period that is
          only pending finalisation. Translated copy keyed on the selected
          form type and the period's status is used instead. */}
      {!errored && reconciliation?.filingBlocked && (
        <div
          role="alert"
          style={{
            background: "var(--badbg)",
            border: "1px solid var(--bad)",
            borderRadius: 10,
            padding: "12px 16px",
            marginBottom: 16,
            fontSize: 13,
            color: "var(--bad)",
          }}
        >
          <strong>{t("filingBlockedHeading", { formType })}</strong>
          <p style={{ margin: "4px 0 0" }}>
            {blockingStatus === "pending_finalisation"
              ? t("filingBlockedPendingBody", { formType, period })
              : t("filingBlockedMismatchBody", { formType, period })}
          </p>
        </div>
      )}

      <StatGrid>
        <StatCard icon="🧾" iconBg="var(--infobg)" label={t("statChallansForPeriod")} value={errored ? "—" : rows.length} />
        <StatCard
          icon={reconciled ? "✅" : "⚠️"}
          iconBg={reconciled ? "var(--goodbg)" : "var(--badbg)"}
          label={t("statReconciliationStatus")}
          value={errored ? "—" : reconcileStatusLabel}
        />
        <StatCard icon="📉" iconBg="var(--warnbg)" label={t("statVariance")} value={errored ? "—" : (reconciliation ? formatMoney(reconciliation.varianceMinor) : "—")} />
        <StatCard icon="💰" iconBg="var(--goodbg)" label={t("statTdsDeposited")} value={errored ? "—" : (reconciliation ? formatMoney(reconciliation.totalDepositedMinor) : "—")} />
      </StatGrid>

      <IngestChallanForm period={period} />

      <Card title={t("historyCardTitle", { period })}>
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "TDS challans" })} backHref="/hr/payroll/statutory" />
          </div>
        ) : (
          <DataTable<ChallanRow>
          columns={columns}
          rows={rows}
          sortable
          filterable
          filterPlaceholder={t("filterPlaceholder")}
          pageSize={15}
          emptyIcon="🧾"
          emptyTitle={t("emptyTitle")}
          emptyMessage={t("emptyMessage")}
        />
        )}
      </Card>
    </div>
  );
}

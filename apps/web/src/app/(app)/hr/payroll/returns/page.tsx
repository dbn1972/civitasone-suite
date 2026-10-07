import { PageHeader, Card, StatGrid, StatCard, DataTable, EmptyState, RefreshErrorState } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { PermissionDenied } from "../../../../_components/PermissionDenied";
import { maskPan } from "../../../../_components/ds/Masked";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { formatMoney, formatIndianDate } from "@/lib/formatters";
import { statusAwareGet } from "../_lib/statusAwareFetch";
import { QuarterLookupForm } from "./QuarterLookupForm";
import { ForceFileButton } from "./ForceFileButton";
import { RecordFilingForm } from "./RecordFilingForm";
import { RpuDownloadLink } from "./RpuDownloadLink";
import { TaxReturnsSummary, type QuarterSummaryRow } from "./TaxReturnsSummary";
import { toHumanError } from "@/lib/messages";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { PAYROLL_STATUTORY_ADMIN_ROLES } from "@/lib/auth/workRoles";
import { isValidFinancialYear } from "@/lib/payroll/period";
import { sumMinor } from "@/lib/payroll/money";
import { getTranslations } from "next-intl/server";

/**
 * Plain-language failure message for a quarterly-return load, for this
 * server component's own JSX (it's an `async function` page, not a client
 * component, so it can't use the useFormError hook — toHumanError is the
 * same catalogued-message building block that hook is built on). Never a
 * raw status/body — see docs/ENTERPRISE-GAP-REPORT-2026-09-07.md UX-016.
 */
function loadFailureMessage(area: string): string {
  const human = toHumanError("load", { area });
  return `${human.what} ${human.next}`;
}

type Quarter = "Q1" | "Q2" | "Q3" | "Q4";
const QUARTERS: Quarter[] = ["Q1", "Q2", "Q3", "Q4"];

type Deductee24Q = {
  employeeId: string;
  pan: string;
  panFlag: string;
  name: string;
  tdsDeductedMinor: number;
  tdsDepositedMinor: number;
  periods: string[];
};

type Form24Q = {
  formType: "24Q";
  fy: string;
  quarter: Quarter;
  deducteeCount: number;
  deductees: Deductee24Q[];
  reconciliation: { matched: boolean; warning?: string };
  note: string;
  /**
   * GAP-PAYROLL-RETURNS-01: a real filing record, when payroll-service
   * starts returning one. Reconciled-with-TRACES is NOT filed, so without
   * these the quarter is never shown as "filed".
   */
  filedAt: string | null;
  challanRef: string | null;
  /** NSDL provisional receipt number + revision of the latest recorded filing (null when none). */
  filingReceiptNo: string | null;
  filingRevision: number | null;
};

type Deductee26Q = {
  deducteeRef: string;
  name: string;
  pan: string;
  panFlag: string;
  section: string;
  amountPaidMinor: string;
  tdsDeductedMinor: string;
  periods: string[];
};

type Form26Q = {
  formType: "26Q";
  fy: string;
  quarter: Quarter;
  deducteeCount: number;
  deductees: Deductee26Q[];
  totalTdsDeductedMinor: string;
  populated: boolean;
  reconciliation: { matched: boolean };
  note: string;
};

type Form24QLookup =
  | { state: "ok"; data: Form24Q }
  | { state: "reconciliation_blocked"; message: string }
  | { state: "error" };

function currentFyQuarter(): { fy: string; quarter: Quarter } {
  const now = new Date();
  const y = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const fy = `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
  const m = now.getMonth() + 1;
  const quarter: Quarter = m >= 4 && m <= 6 ? "Q1" : m >= 7 && m <= 9 ? "Q2" : m >= 10 && m <= 12 ? "Q3" : "Q4";
  return { fy, quarter };
}

function toForm24Q(raw: unknown): Form24Q | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const deductees = Array.isArray(r.deductees)
    ? (r.deductees as Array<Record<string, unknown>>).map((d) => ({
        employeeId: String(d.employeeId ?? ""),
        pan: String(d.pan ?? ""),
        panFlag: String(d.panFlag ?? ""),
        name: String(d.name ?? ""),
        tdsDeductedMinor: Number(d.tdsDeductedMinor ?? 0),
        tdsDepositedMinor: Number(d.tdsDepositedMinor ?? 0),
        periods: Array.isArray(d.periods) ? (d.periods as string[]) : [],
      }))
    : [];
  return {
    formType: "24Q",
    fy: String(r.fy ?? ""),
    quarter: (r.quarter as Quarter) ?? "Q1",
    deducteeCount: Number(r.deducteeCount ?? deductees.length),
    deductees,
    reconciliation: (r.reconciliation as Form24Q["reconciliation"]) ?? { matched: true },
    note: String(r.note ?? ""),
    filedAt: typeof r.filedAt === "string" && r.filedAt ? r.filedAt : null,
    challanRef: typeof r.challanRef === "string" && r.challanRef ? r.challanRef : null,
    filingReceiptNo: typeof r.filingReceiptNo === "string" && r.filingReceiptNo ? r.filingReceiptNo : null,
    filingRevision: typeof r.filingRevision === "number" ? r.filingRevision : null,
  };
}

/**
 * Plain read — never bypasses the TRACES reconciliation gate. Forcing past it
 * is a separate, explicit action (see ForceFileButton.tsx), not a query param
 * on this GET, so this loader has nothing to pass through for it any more.
 */
async function getForm24Q(fy: string, quarter: Quarter, t: (key: string) => string): Promise<Form24QLookup> {
  const r = await statusAwareGet(
    "/v1/payroll/statutory/form24q?fy=" + encodeURIComponent(fy) + "&quarter=" + quarter,
  );
  if (r.kind === "ok") {
    const data = toForm24Q(r.body);
    return data ? { state: "ok", data } : { state: "error" };
  }
  if (r.kind === "http_error" && r.status === 409) {
    return {
      state: "reconciliation_blocked",
      message: t("reconciliationBlockedMessage"),
    };
  }
  return { state: "error" };
}

async function getForm26Q(fy: string, quarter: Quarter): Promise<LoaderResult<Form26Q | null>> {
  return fetchJson<unknown, Form26Q | null>(
    "/api/v1/payroll/statutory/form26q?fy=" + encodeURIComponent(fy) + "&quarter=" + quarter,
    null,
    {
      telemetryKey: "payroll.statutory.form26q",
      mapResponse: (p) => (p && typeof p === "object" ? (p as Form26Q) : null),
    },
  );
}

/** GAP-PAYROLL-RETURNS-05: status-pill key for a deductee's PAN (PANNOTAVBL = no PAN on record). */
function panStatus(pan: string, panFlag: string): "pan ok" | "pan missing" {
  return !pan || panFlag ? "pan missing" : "pan ok";
}

/** Annual-overview row for one quarter's Form-24Q lookup. */
function quarterSummary(q: Quarter, lookup: Form24QLookup): QuarterSummaryRow {
  if (lookup.state === "ok") {
    const d = lookup.data;
    const deposited = sumMinor(d.deductees.map((x) => x.tdsDepositedMinor));
    return {
      quarter: q,
      // GAP-PAYROLL-RETURNS-01: matched -> "reconciled", never "filed".
      status: d.filedAt ? "filed" : d.reconciliation.matched ? "reconciled" : "unreconciled",
      filingDate: d.filedAt,
      challanRef: d.challanRef,
      totalTdsDepositedMinor: deposited === null ? null : Number(deposited),
      deducteeCount: d.deducteeCount,
    };
  }
  // GAP-PAYROLL-RETURNS-02/03: blocked/failed quarters are unknown (null
  // totals -> "—"), not "pending" with a fabricated ₹0.
  return {
    quarter: q,
    status: lookup.state === "reconciliation_blocked" ? "blocked" : "not loaded",
    filingDate: null,
    challanRef: null,
    totalTdsDepositedMinor: null,
    deducteeCount: null,
  };
}

export default async function ReturnsPage({
  searchParams,
}: {
  searchParams: { fy?: string; quarter?: string };
}) {
  const t = await getTranslations("payrollReturns");
  // GAP-PAYROLL-RETURNS-04: form24q/form26q and the force-file bypass are all
  // RETURN_FILER_ROLES in payroll-service (payroll_admin, payroll_officer,
  // super_admin, hr_admin, finance_officer -- identical to
  // PAYROLL_STATUTORY_ADMIN_ROLES). hr/layout.tsx also admits employee and
  // manager, who used to see the "File anyway -- bypass reconciliation"
  // affordance (and a failed load). Gate the page before any fetch.
  if (!getSessionRoles().some((r) => PAYROLL_STATUTORY_ADMIN_ROLES.includes(r))) {
    return <PermissionDenied module="TDS returns (24Q/26Q)" requiredRoles={PAYROLL_STATUTORY_ADMIN_ROLES} backHref="/hr/payroll" backLabel={t("backToPayrollLabel")} />;
  }
  // GAP-PAYROLL-RETURNS-01: payroll-service's filing-record roles (hr_admin may read, not record).
  const canRecordFiling = getSessionRoles().some((r) => ["payroll_admin", "payroll_officer", "super_admin", "finance_officer"].includes(r));
  // TaxReturnsSummary/QuarterLookupForm are plain (non-async) components --
  // see their own file comments -- so this page resolves their translators
  // once, here, and passes them down as props.
  const tSummary = await getTranslations("taxReturnsSummary");
  const tQuarterForm = await getTranslations("quarterLookupForm");
  const { fy: defFy, quarter: defQuarter } = currentFyQuarter();
  // GAP-PAYROLL-RETURNS-07: an invalid ?fy= / ?quarter= falls back visibly
  // (role="alert" naming the value used), and 2025-99 is no longer a FY.
  const rawFy = searchParams.fy?.trim() ?? "";
  const rawQuarter = searchParams.quarter?.trim() ?? "";
  const fyInvalid = rawFy !== "" && !isValidFinancialYear(rawFy);
  const quarterInvalid = rawQuarter !== "" && !(QUARTERS as string[]).includes(rawQuarter);
  const fy = rawFy && !fyInvalid ? rawFy : defFy;
  const quarter = rawQuarter && !quarterInvalid ? (rawQuarter as Quarter) : defQuarter;

  // GAP-PAYROLL-RETURNS-02: the annual overview used to show only the
  // selected quarter and stub the other three as pending/₹0. Load all four.
  const [lookups, { data: f26, source: src26 }] = await Promise.all([
    Promise.all(QUARTERS.map((q) => getForm24Q(fy, q, t))),
    getForm26Q(fy, quarter),
  ]);
  const f24Lookup = lookups[QUARTERS.indexOf(quarter)];

  const overallSource: "api" | "error" =
    f24Lookup.state === "error" || src26 === "error" ? "error" : "api";

  const rows24 = f24Lookup.state === "ok"
    // Review fix (PR #1762): the raw pan/panFlag are dropped here. DataTable
    // is a client component, so every field on a row is serialised into the
    // RSC payload -- spreading `d` shipped every full PAN to the browser even
    // though the visible column was masked.
    ? f24Lookup.data.deductees.map(({ pan, panFlag, ...rest }) => ({
        ...rest,
        id: rest.employeeId,
        panMasked: pan ? maskPan(pan) : "—",
        panStatus: panStatus(pan, panFlag),
      }))
    : [];
  const panStatusLabels = { "pan ok": t("panOk"), "pan missing": t("panMissing") };
  const cols24: { key: keyof (typeof rows24)[number] & string; label: string; align?: "left" | "right"; cellType?: "amount" | "status"; statusLabels?: Record<string, string> }[] = [
    { key: "name", label: t("colEmployee") },
    { key: "panMasked", label: t("colPan") },
    { key: "panStatus", label: t("colPanStatus"), cellType: "status", statusLabels: panStatusLabels },
    { key: "tdsDeductedMinor", label: t("colTdsDeducted"), align: "right", cellType: "amount" },
    { key: "tdsDepositedMinor", label: t("colTdsDeposited"), align: "right", cellType: "amount" },
  ];
  const panMissing24 = rows24.filter((r) => r.panStatus === "pan missing").length;
  const totalTdsDeductedMinor24 = rows24.reduce((s, d) => s + d.tdsDeductedMinor, 0);
  const totalTdsDepositedMinor24 = rows24.reduce((s, d) => s + d.tdsDepositedMinor, 0);
  const varianceMinor24 = totalTdsDeductedMinor24 - totalTdsDepositedMinor24;

  const rows26 = (f26?.deductees ?? []).map(({ pan, panFlag, ...rest }) => ({
    ...rest,
    id: rest.deducteeRef,
    panMasked: pan ? maskPan(pan) : "—",
    panStatus: panStatus(pan, panFlag),
  }));
  const totalAmountPaidMinor26 = sumMinor(rows26.map((d) => d.amountPaidMinor));
  const cols26: { key: keyof (typeof rows26)[number] & string; label: string; align?: "left" | "right"; cellType?: "amount" | "status"; statusLabels?: Record<string, string> }[] = [
    { key: "name", label: t("colDeductee") },
    { key: "panMasked", label: t("colPan") },
    { key: "panStatus", label: t("colPanStatus"), cellType: "status", statusLabels: panStatusLabels },
    { key: "section", label: t("colSection") },
    { key: "amountPaidMinor", label: t("colAmountPaid"), align: "right", cellType: "amount" },
    { key: "tdsDeductedMinor", label: t("colTdsDeducted"), align: "right", cellType: "amount" },
  ];

  const quarterSummaries: QuarterSummaryRow[] = QUARTERS.map((q, i) => quarterSummary(q, lookups[i]));
  const allQuartersFailed = lookups.every((l) => l.state === "error");
  const rpuHref = (form: "form24q" | "form26q") =>
    `/api/proxy/v1/payroll/statutory/${form}?fy=${encodeURIComponent(fy)}&quarter=${quarter}&format=file`;

  return (
    <div className="page-main wrap">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr/payroll" backLabel={t("backToPayrollLabel")}
      />

      <DataSourceBadge source={overallSource} message={t("loadErrorMessage")} />

      {(fyInvalid || quarterInvalid) && (
        <p role="alert" className="pill warn" style={{ width: "fit-content" }}>
          {fyInvalid ? t("fyInvalidFallback", { value: rawFy, fallback: fy }) : t("quarterInvalidFallback", { value: rawQuarter, fallback: quarter })}
        </p>
      )}

      {/* Q1-Q4 annual overview with filing dates, challan refs, TDS totals */}
      <Card title={t("annualOverviewTitle", { fy })}>
        <div className="pad">
          {allQuartersFailed ? (
            <RefreshErrorState error={toHumanError("load", { area: "TDS returns" })} backHref="/hr/payroll" />
          ) : (
            <TaxReturnsSummary fy={fy} quarters={quarterSummaries} t={tSummary} />
          )}
        </div>
      </Card>

      <QuarterLookupForm defaultFy={fy} defaultQuarter={quarter} quarters={QUARTERS} t={tQuarterForm} />

      <Card title={t("form24qTitle", { fy, quarter })}>
        <div className="pad">
          {f24Lookup.state === "reconciliation_blocked" ? (
            <>
              <EmptyState icon="⚠️" title={t("form24qBlockedTitle", { fy, quarter })} message={f24Lookup.message} />
              <ForceFileButton fy={fy} quarter={quarter} />
            </>
          ) : f24Lookup.state === "error" ? (
            <>
              <EmptyState
                icon="⚠️"
                title={t("form24qErrorTitle", { fy, quarter })}
                message={loadFailureMessage("Form-24Q return")}
              />
            </>
          ) : (
            <>
              <StatGrid>
                <StatCard icon="👥" iconBg="var(--infobg)" label={t("statDeductees")} value={f24Lookup.data.deducteeCount} />
                <StatCard icon="💰" iconBg="var(--goodbg)" label={t("statTdsDeducted")} value={formatMoney(totalTdsDeductedMinor24)} />
                <StatCard
                  icon={f24Lookup.data.reconciliation.matched ? "✅" : "⚠️"}
iconBg={f24Lookup.data.reconciliation.matched ? "var(--goodbg, #e6f7f0)" : "var(--badbg, #fdecea)"}
                  label={t("statReconciliation")}
                  value={f24Lookup.data.reconciliation.matched ? t("matched") : t("unreconciled")}
                />
                <StatCard icon="🏦" iconBg="var(--warnbg)" label={t("statTdsDeposited")} value={formatMoney(totalTdsDepositedMinor24)} />
                <StatCard icon="⚠️" iconBg="var(--errorbg)" label={t("statVariance")} value={formatMoney(varianceMinor24)} />
                <StatCard icon="🪪" iconBg="var(--badbg, #fdecea)" label={t("statPanMissing")} value={panMissing24} />
              </StatGrid>
              {f24Lookup.data.reconciliation.warning && (
                <p role="alert" className="pill bad" style={{ width: "fit-content", marginTop: 10 }}>
                  {f24Lookup.data.reconciliation.warning}
                </p>
              )}
              <div style={{ marginTop: 12 }}>
                <DataTable
                  columns={cols24}
                  rows={rows24}
                  sortable
                  filterable
                  filterPlaceholder={t("filterPlaceholder24q")}
                  pageSize={15}
                  emptyIcon="🧾"
                  emptyTitle={t("noDeductees24qTitle")}
                  emptyMessage={t("noDeductees24qMessage")}
                />
              </div>
              <p style={{ fontSize: "12.5px", color: "var(--color-text-muted)", marginTop: 10 }}>{f24Lookup.data.note}</p>
              <p style={{ marginTop: 10 }}>
                <RpuDownloadLink href={rpuHref("form24q")} reconciled={f24Lookup.data.reconciliation.matched} />
              </p>
              {/* GAP-PAYROLL-RETURNS-01: Filed only when a filing is recorded. */}
              {f24Lookup.data.filedAt ? (
                <p role="status" className="pill good" style={{ width: "fit-content", marginTop: 10 }}>
                  {t("filedLine", { date: formatIndianDate(f24Lookup.data.filedAt), receipt: f24Lookup.data.filingReceiptNo ?? "—" })}
                </p>
              ) : (
                <p role="note" className="pill warn" style={{ width: "fit-content", marginTop: 10 }}>{t("notFiledLine")}</p>
              )}
              {canRecordFiling && (
                <RecordFilingForm fy={fy} quarter={quarter} currentRevision={f24Lookup.data.filingRevision} />
              )}
            </>
          )}
        </div>
      </Card>

      <Card title={t("form26qTitle", { fy, quarter })}>
        <div className="pad">
          {f26 === null ? (
            <>
              <EmptyState
                icon="⚠️"
                title={t("form26qErrorTitle", { fy, quarter })}
                message={loadFailureMessage("Form-26Q return")}
              />
            </>
          ) : !f26.populated ? (
            <EmptyState icon="🧾" title={t("form26qNotPopulated")} message={f26.note} />
          ) : (
            <>
              <StatGrid>
                <StatCard icon="👥" iconBg="var(--infobg)" label={t("statDeductees")} value={f26.deducteeCount} />
                <StatCard icon="💰" iconBg="var(--goodbg)" label={t("statTdsDeducted")} value={formatMoney(f26.totalTdsDeductedMinor)} />
                <StatCard
                  icon={f26.reconciliation.matched ? "✅" : "⚠️"}
iconBg={f26.reconciliation.matched ? "var(--goodbg, #e6f7f0)" : "var(--badbg, #fdecea)"}
                  label={t("statReconciliation")}
                  value={f26.reconciliation.matched ? t("matched") : t("unreconciled")}
                />
                <StatCard icon="💳" iconBg="var(--warnbg)" label={t("statAmountPaid")} value={formatMoney(totalAmountPaidMinor26)} />
              </StatGrid>
              <div style={{ marginTop: 12 }}>
                <DataTable
                  columns={cols26}
                  rows={rows26}
                  sortable
                  filterable
                  filterPlaceholder={t("filterPlaceholder26q")}
                  pageSize={15}
                  emptyIcon="🧾"
                  emptyTitle={t("noDeductees26qTitle")}
                />
              </div>
              <p style={{ fontSize: "12.5px", color: "var(--color-text-muted)", marginTop: 10 }}>{f26.note}</p>
              <p style={{ marginTop: 10 }}>
                <RpuDownloadLink href={rpuHref("form26q")} reconciled={f26.reconciliation.matched} />
              </p>
            </>
          )}
        </div>
      </Card>
    </div>
  );
}

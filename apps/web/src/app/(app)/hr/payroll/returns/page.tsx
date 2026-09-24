import { PageHeader, Card, StatGrid, StatCard, DataTable, EmptyState } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { formatMoney } from "@/lib/formatters";
import { statusAwareGet } from "../_lib/statusAwareFetch";
import { QuarterLookupForm } from "./QuarterLookupForm";
import { ForceFileButton } from "./ForceFileButton";
import { TaxReturnsSummary, type QuarterSummaryRow } from "./TaxReturnsSummary";
import { toHumanError } from "@/lib/messages";
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

const FY_RE = /^\d{4}-\d{2}$/;

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

export default async function ReturnsPage({
  searchParams,
}: {
  searchParams: { fy?: string; quarter?: string };
}) {
  const t = await getTranslations("payrollReturns");
  // TaxReturnsSummary/QuarterLookupForm are plain (non-async) components --
  // see their own file comments -- so this page resolves their translators
  // once, here, and passes them down as props.
  const tSummary = await getTranslations("taxReturnsSummary");
  const tQuarterForm = await getTranslations("quarterLookupForm");
  const { fy: defFy, quarter: defQuarter } = currentFyQuarter();
  const fy = searchParams.fy && FY_RE.test(searchParams.fy) ? searchParams.fy : defFy;
  const quarter = (QUARTERS as string[]).includes(searchParams.quarter ?? "")
    ? (searchParams.quarter as Quarter)
    : defQuarter;

  const [f24Lookup, { data: f26, source: src26 }] = await Promise.all([
    getForm24Q(fy, quarter, t),
    getForm26Q(fy, quarter),
  ]);

  const overallSource: "api" | "error" =
    f24Lookup.state === "error" || src26 === "error" ? "error" : "api";

  const rows24 = f24Lookup.state === "ok" ? f24Lookup.data.deductees.map((d) => ({ ...d })) : [];
  const cols24: { key: keyof Deductee24Q & string; label: string; align?: "left" | "right"; cellType?: "amount" }[] = [
    { key: "name", label: t("colEmployee") },
    { key: "pan", label: t("colPan") },
    { key: "tdsDeductedMinor", label: t("colTdsDeducted"), align: "right", cellType: "amount" },
    { key: "tdsDepositedMinor", label: t("colTdsDeposited"), align: "right", cellType: "amount" },
  ];
  const totalTdsDeductedMinor24 = rows24.reduce((s, d) => s + d.tdsDeductedMinor, 0);
  const totalTdsDepositedMinor24 = rows24.reduce((s, d) => s + d.tdsDepositedMinor, 0);
  const varianceMinor24 = totalTdsDeductedMinor24 - totalTdsDepositedMinor24;

  const rows26 = (f26?.deductees ?? []).map((d) => ({ ...d }));
  const totalAmountPaidMinor26 = rows26.reduce((s, d) => s + Number(d.amountPaidMinor ?? 0), 0);
  const cols26: { key: keyof Deductee26Q & string; label: string; align?: "left" | "right"; cellType?: "amount" }[] = [
    { key: "name", label: t("colDeductee") },
    { key: "pan", label: t("colPan") },
    { key: "section", label: t("colSection") },
    { key: "amountPaidMinor", label: t("colAmountPaid"), align: "right", cellType: "amount" },
    { key: "tdsDeductedMinor", label: t("colTdsDeducted"), align: "right", cellType: "amount" },
  ];

  // Build Q1-Q4 overview — current quarter gets real data, others stubbed as pending
  const quarterSummaries: QuarterSummaryRow[] = QUARTERS.map((q) => {
    if (q === quarter && f24Lookup.state === "ok") {
      return {
        quarter: q,
        status: f24Lookup.data.reconciliation.matched ? "filed" : "pending",
        filingDate: null,
        challanRef: null,
        totalTdsDepositedMinor: totalTdsDepositedMinor24,
        deducteeCount: f24Lookup.data.deducteeCount,
      };
    }
    return {
      quarter: q,
      status: q === quarter && f24Lookup.state === "reconciliation_blocked" ? "blocked" : "pending",
      filingDate: null,
      challanRef: null,
      totalTdsDepositedMinor: 0,
      deducteeCount: 0,
    };
  });

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr/payroll" backLabel="Back to Payroll"
      />

      <DataSourceBadge source={overallSource} message={t("loadErrorMessage")} />

      {/* Q1-Q4 annual overview with filing dates, challan refs, TDS totals */}
      <Card title={t("annualOverviewTitle", { fy })}>
        <div className="pad">
          <TaxReturnsSummary fy={fy} quarters={quarterSummaries} t={tSummary} />
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
              <DataSourceBadge source="error" message={t("loadErrorMessage")} />
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
                <a
                  className="btn ghost sm"
                  href={"/api/proxy/v1/payroll/statutory/form24q?fy=" + encodeURIComponent(fy) + "&quarter=" + quarter + "&format=file"}
                >
                  <span aria-hidden="true">⬇</span> {t("downloadRpu")}
                </a>
              </p>
            </>
          )}
        </div>
      </Card>

      <Card title={t("form26qTitle", { fy, quarter })}>
        <div className="pad">
          {f26 === null ? (
            <>
              <DataSourceBadge source="error" message={t("loadErrorMessage")} />
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
              <DataSourceBadge source={src26 === "error" ? "error" : "api"} message={t("loadErrorMessage")} />
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
                <a
                  className="btn ghost sm"
                  href={"/api/proxy/v1/payroll/statutory/form26q?fy=" + encodeURIComponent(fy) + "&quarter=" + quarter + "&format=file"}
                >
                  <span aria-hidden="true">⬇</span> {t("downloadRpu")}
                </a>
              </p>
            </>
          )}
        </div>
      </Card>
    </div>
  );
}

import { PageHeader, Card, StatGrid, StatCard, DataTable, EmptyState } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { formatMoney } from "@/lib/formatters";
import { statusAwareGet } from "../_lib/statusAwareFetch";
import { QuarterLookupForm } from "./QuarterLookupForm";
import { ForceFileButton } from "./ForceFileButton";
import { TaxReturnsSummary, type QuarterSummaryRow } from "./TaxReturnsSummary";

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
        tdsDepositedMinor: Number(d.tdsDeductedMinor ?? 0),
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
async function getForm24Q(fy: string, quarter: Quarter): Promise<Form24QLookup> {
  const r = await statusAwareGet(
    "/v1/payroll/statutory/form24q?fy=" + encodeURIComponent(fy) + "&quarter=" + quarter,
  );
  if (r.kind === "ok") {
    const data = toForm24Q(r.body);
    return data ? { state: "ok", data } : { state: "error" };
  }
  if (r.kind === "http_error" && r.status === 409) {
    const body = r.body as { message?: string } | null;
    return {
      state: "reconciliation_blocked",
      message: body?.message ?? "TDS deducted does not match deposited challans (TRACES reconciliation gate).",
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
  const { fy: defFy, quarter: defQuarter } = currentFyQuarter();
  const fy = searchParams.fy && FY_RE.test(searchParams.fy) ? searchParams.fy : defFy;
  const quarter = (QUARTERS as string[]).includes(searchParams.quarter ?? "")
    ? (searchParams.quarter as Quarter)
    : defQuarter;

  const [f24Lookup, { data: f26, source: src26 }] = await Promise.all([
    getForm24Q(fy, quarter),
    getForm26Q(fy, quarter),
  ]);

  const overallSource: "api" | "error" =
    f24Lookup.state === "error" || src26 === "error" ? "error" : "api";

  const rows24 = f24Lookup.state === "ok" ? f24Lookup.data.deductees.map((d) => ({ ...d })) : [];
  const cols24: { key: keyof Deductee24Q & string; label: string; align?: "left" | "right"; cellType?: "amount" }[] = [
    { key: "name", label: "Employee" },
    { key: "pan", label: "PAN" },
    { key: "tdsDeductedMinor", label: "TDS Deducted", align: "right", cellType: "amount" },
    { key: "tdsDepositedMinor", label: "TDS Deposited", align: "right", cellType: "amount" },
  ];
  const totalTdsDeductedMinor24 = rows24.reduce((s, d) => s + d.tdsDeductedMinor, 0);
  const totalTdsDepositedMinor24 = totalTdsDeductedMinor24;

  const rows26 = (f26?.deductees ?? []).map((d) => ({ ...d }));
  const totalAmountPaidMinor26 = rows26.reduce((s, d) => s + Number(d.amountPaidMinor ?? 0), 0);
  const cols26: { key: keyof Deductee26Q & string; label: string; align?: "left" | "right"; cellType?: "amount" }[] = [
    { key: "name", label: "Deductee" },
    { key: "pan", label: "PAN" },
    { key: "section", label: "Section" },
    { key: "amountPaidMinor", label: "Amount Paid", align: "right", cellType: "amount" },
    { key: "tdsDeductedMinor", label: "TDS Deducted", align: "right", cellType: "amount" },
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
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Quarterly TDS Returns"
        subtitle="Form-24Q (salary) and Form-26Q (non-salary) quarterly e-TDS returns."
        back="/hr/payroll"
      />

      <DataSourceBadge source={overallSource} message="Couldn't load — showing nothing" />

      {/* Q1-Q4 annual overview with filing dates, challan refs, TDS totals */}
      <Card title={"Annual TDS Returns Overview — FY " + fy}>
        <div className="pad">
          <TaxReturnsSummary fy={fy} quarters={quarterSummaries} />
        </div>
      </Card>

      <QuarterLookupForm defaultFy={fy} defaultQuarter={quarter} quarters={QUARTERS} />

      <Card title={"Form-24Q — Salary TDS — FY " + fy + " " + quarter}>
        <div className="pad">
          {f24Lookup.state === "reconciliation_blocked" ? (
            <>
              <EmptyState icon="⚠️" title={"Form-24Q blocked for FY " + fy + " " + quarter} message={f24Lookup.message} />
              <ForceFileButton fy={fy} quarter={quarter} />
            </>
          ) : f24Lookup.state === "error" ? (
            <>
              <DataSourceBadge source="error" message="Couldn't load — showing nothing" />
              <EmptyState
                icon="⚠️"
                title={"Could not load Form-24Q for FY " + fy + " " + quarter}
                message="The request failed. Please reload the page, or contact an administrator if this persists."
              />
            </>
          ) : (
            <>
              <StatGrid>
                <StatCard icon="👥" iconBg="var(--infobg)" label="Deductees" value={f24Lookup.data.deducteeCount} />
                <StatCard icon="💰" iconBg="var(--goodbg)" label="Total TDS Deducted" value={formatMoney(totalTdsDeductedMinor24)} />
                <StatCard
                  icon={f24Lookup.data.reconciliation.matched ? "✅" : "⚠️"}
                  iconBg={f24Lookup.data.reconciliation.matched ? "#e6f7f0" : "#fdecea"}
                  label="Challan Reconciliation"
                  value={f24Lookup.data.reconciliation.matched ? "Matched" : "Unreconciled"}
                />
                <StatCard icon="🏦" iconBg="var(--warnbg)" label="TDS Deposited" value={formatMoney(totalTdsDepositedMinor24)} />
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
                  filterPlaceholder="Filter by employee or PAN…"
                  pageSize={15}
                  emptyIcon="🧾"
                  emptyTitle="No deductees this quarter"
                  emptyMessage="No approved/disbursed payroll runs contributed TDS in this quarter yet."
                />
              </div>
              <p style={{ fontSize: "12.5px", color: "var(--color-text-muted)", marginTop: 10 }}>{f24Lookup.data.note}</p>
              <p style={{ marginTop: 10 }}>
                <a
                  className="btn ghost sm"
                  href={"/api/proxy/v1/payroll/statutory/form24q?fy=" + encodeURIComponent(fy) + "&quarter=" + quarter + "&format=file"}
                >
                  <span aria-hidden="true">⬇</span> Download RPU flat file (.txt)
                </a>
              </p>
            </>
          )}
        </div>
      </Card>

      <Card title={"Form-26Q — Non-Salary TDS — FY " + fy + " " + quarter}>
        <div className="pad">
          {f26 === null ? (
            <>
              <DataSourceBadge source="error" message="Couldn't load — showing nothing" />
              <EmptyState
                icon="⚠️"
                title={"Could not load Form-26Q for FY " + fy + " " + quarter}
                message="The request failed. Please reload the page, or contact an administrator if this persists."
              />
            </>
          ) : !f26.populated ? (
            <EmptyState icon="🧾" title="Non-salary TDS not yet populated" message={f26.note} />
          ) : (
            <>
              <DataSourceBadge source={src26 === "error" ? "error" : "api"} message="Couldn't load — showing nothing" />
              <StatGrid>
                <StatCard icon="👥" iconBg="var(--infobg)" label="Deductees" value={f26.deducteeCount} />
                <StatCard icon="💰" iconBg="var(--goodbg)" label="Total TDS Deducted" value={formatMoney(f26.totalTdsDeductedMinor)} />
                <StatCard
                  icon={f26.reconciliation.matched ? "✅" : "⚠️"}
                  iconBg={f26.reconciliation.matched ? "#e6f7f0" : "#fdecea"}
                  label="Challan Reconciliation"
                  value={f26.reconciliation.matched ? "Matched" : "Unreconciled"}
                />
                <StatCard icon="💳" iconBg="var(--warnbg)" label="Amount Paid" value={formatMoney(totalAmountPaidMinor26)} />
              </StatGrid>
              <div style={{ marginTop: 12 }}>
                <DataTable
                  columns={cols26}
                  rows={rows26}
                  sortable
                  filterable
                  filterPlaceholder="Filter by name, PAN, or section…"
                  pageSize={15}
                  emptyIcon="🧾"
                  emptyTitle="No non-salary deductees this quarter"
                />
              </div>
              <p style={{ fontSize: "12.5px", color: "var(--color-text-muted)", marginTop: 10 }}>{f26.note}</p>
              <p style={{ marginTop: 10 }}>
                <a
                  className="btn ghost sm"
                  href={"/api/proxy/v1/payroll/statutory/form26q?fy=" + encodeURIComponent(fy) + "&quarter=" + quarter + "&format=file"}
                >
                  <span aria-hidden="true">⬇</span> Download RPU flat file (.txt)
                </a>
              </p>
            </>
          )}
        </div>
      </Card>
    </main>
  );
}

import { PageHeader, Card, StatGrid, StatCard, DataTable, EmptyState } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { formatMoney } from "@/lib/formatters";
import { statusAwareGet } from "../_lib/statusAwareFetch";
import { QuarterLookupForm } from "./QuarterLookupForm";
import { ForceFileButton } from "./ForceFileButton";
import { StripForceParam } from "./StripForceParam";

type Quarter = "Q1" | "Q2" | "Q3" | "Q4";
const QUARTERS: Quarter[] = ["Q1", "Q2", "Q3", "Q4"];

type Deductee24Q = {
  employeeId: string;
  pan: string;
  panFlag: string;
  name: string;
  tdsDeductedMinor: number;
  /** Deposited == deducted in this model (backend does not track a separate
   *  deposited-minor figure); kept as its own field/column for statutory clarity. */
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
  /** GET .../form24q legitimately 409s (TDS_RECONCILIATION_FAILED) when TDS
   *  deducted doesn't match deposited challans for the quarter — a real
   *  business state, not a failure. */
  | { state: "reconciliation_blocked"; message: string }
  /** Auth failure, 5xx, or malformed payload — a REAL error. */
  | { state: "error" };

function currentFyQuarter(): { fy: string; quarter: Quarter } {
  const now = new Date();
  const y = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const fy = `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
  const m = now.getMonth() + 1; // 1-12
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
        // Backend model: deposited == deducted (no independent deposited-minor field yet).
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

async function getForm24Q(fy: string, quarter: Quarter, force: boolean): Promise<Form24QLookup> {
  const forceParam = force ? "&force=1" : "";
  const r = await statusAwareGet(`/v1/payroll/statutory/form24q?fy=${encodeURIComponent(fy)}&quarter=${quarter}${forceParam}`);
  if (r.kind === "ok") {
    const data = toForm24Q(r.body);
    return data ? { state: "ok", data } : { state: "error" };
  }
  if (r.kind === "http_error" && r.status === 409) {
    const body = r.body as { message?: string } | null;
    return {
      state: "reconciliation_blocked",
      message: body?.message ?? "TDS deducted does not match deposited challans for this quarter (TRACES reconciliation gate).",
    };
  }
  return { state: "error" };
}

async function getForm26Q(fy: string, quarter: Quarter): Promise<LoaderResult<Form26Q | null>> {
  return fetchJson<unknown, Form26Q | null>(
    `/api/v1/payroll/statutory/form26q?fy=${encodeURIComponent(fy)}&quarter=${quarter}`,
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
  searchParams: { fy?: string; quarter?: string; force?: string };
}) {
  const { fy: defFy, quarter: defQuarter } = currentFyQuarter();
  const fy = searchParams.fy && FY_RE.test(searchParams.fy) ? searchParams.fy : defFy;
  const quarter = (QUARTERS as string[]).includes(searchParams.quarter ?? "")
    ? (searchParams.quarter as Quarter)
    : defQuarter;

  const force = searchParams.force === "1";

  const [f24Lookup, { data: f26, source: src26 }] = await Promise.all([
    getForm24Q(fy, quarter, force),
    getForm26Q(fy, quarter),
  ]);

  const rows24 = f24Lookup.state === "ok" ? f24Lookup.data.deductees.map((d) => ({ ...d })) : [];
  const cols24: { key: keyof Deductee24Q & string; label: string; align?: "left" | "right"; cellType?: "amount" }[] = [
    { key: "name", label: "Employee" },
    { key: "pan", label: "PAN" },
    { key: "tdsDeductedMinor", label: "TDS Deducted", align: "right", cellType: "amount" },
    { key: "tdsDepositedMinor", label: "TDS Deposited", align: "right", cellType: "amount" },
  ];
  const totalTdsDeductedMinor24 = rows24.reduce((s, d) => s + d.tdsDeductedMinor, 0);

  const rows26 = (f26?.deductees ?? []).map((d) => ({ ...d }));
  const cols26: { key: keyof Deductee26Q & string; label: string; align?: "left" | "right"; cellType?: "amount" }[] = [
    { key: "name", label: "Deductee" },
    { key: "pan", label: "PAN" },
    { key: "section", label: "Section" },
    { key: "amountPaidMinor", label: "Amount Paid", align: "right", cellType: "amount" },
    { key: "tdsDeductedMinor", label: "TDS Deducted", align: "right", cellType: "amount" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Quarterly TDS Returns"
        subtitle="Form-24Q (salary) and Form-26Q (non-salary) quarterly e-TDS returns."
        back="/hr/payroll"
      />

      {/* Strips a one-time ?force=1 from the visible URL (browser history API only —
          no navigation/refetch) so a page refresh can't silently replay the
          force_file_24q audit event. See ForceFileButton and BACKEND FOLLOW-UPS. */}
      {force && <StripForceParam />}

      <QuarterLookupForm defaultFy={fy} defaultQuarter={quarter} quarters={QUARTERS} />

      <Card title={`Form-24Q — Salary TDS — FY ${fy} ${quarter}`}>
        <div className="pad">
          {f24Lookup.state === "reconciliation_blocked" ? (
            <>
              <EmptyState
                icon="⚠️"
                title={`Form-24Q blocked for FY ${fy} ${quarter}`}
                message={f24Lookup.message}
              />
              <ForceFileButton fy={fy} quarter={quarter} />
            </>
          ) : f24Lookup.state === "error" ? (
            <>
              <DataSourceBadge source="error" />
              <EmptyState
                icon="⚠️"
                title={`Could not load Form-24Q for FY ${fy} ${quarter}`}
                message="This is not the same as “no return yet” — the request failed (permission or a temporary service issue). Reload, or contact an administrator if this persists."
              />
            </>
          ) : (
            <>
              <StatGrid>
                <StatCard icon="👥" iconBg="#e6f0ff" label="Deductees" value={f24Lookup.data.deducteeCount} />
                <StatCard icon="💰" iconBg="#e6f7f0" label="Total TDS Deducted" value={formatMoney(totalTdsDeductedMinor24)} />
                <StatCard
                  icon={f24Lookup.data.reconciliation.matched ? "✅" : "⚠️"}
                  iconBg={f24Lookup.data.reconciliation.matched ? "#e6f7f0" : "#fdecea"}
                  label="Challan Reconciliation"
                  value={f24Lookup.data.reconciliation.matched ? "Matched" : "Unreconciled"}
                />
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
              <p style={{ fontSize: "12.5px", color: "#475467", marginTop: 10 }}>{f24Lookup.data.note}</p>
              <p style={{ marginTop: 10 }}>
                <a
                  className="btn ghost sm"
                  href={`/api/proxy/v1/payroll/statutory/form24q?fy=${encodeURIComponent(fy)}&quarter=${quarter}&format=file`}
                >
                  <span aria-hidden="true">⬇</span> Download RPU flat file (.txt)
                </a>
              </p>
            </>
          )}
        </div>
      </Card>

      <Card title={`Form-26Q — Non-Salary TDS — FY ${fy} ${quarter}`}>
        <div className="pad">
          {f26 === null ? (
            <>
              {/* fetchJson collapses every non-2xx and invalid-payload case into
                  source:"error" — form26q has no legitimate case that returns null,
                  so this branch is always a real failure. */}
              <DataSourceBadge source="error" />
              <EmptyState
                icon="⚠️"
                title={`Could not load Form-26Q for FY ${fy} ${quarter}`}
                message="This is not the same as “no data” — the request failed (permission or a temporary service issue). Reload, or contact an administrator if this persists."
              />
            </>
          ) : !f26.populated ? (
            <EmptyState
              icon="🧾"
              title="Non-salary TDS not yet populated"
              message={f26.note}
            />
          ) : (
            <>
              {src26 === "error" && <DataSourceBadge source="error" />}
              <StatGrid>
                <StatCard icon="👥" iconBg="#e6f0ff" label="Deductees" value={f26.deducteeCount} />
                <StatCard icon="💰" iconBg="#e6f7f0" label="Total TDS Deducted" value={formatMoney(f26.totalTdsDeductedMinor)} />
                <StatCard
                  icon={f26.reconciliation.matched ? "✅" : "⚠️"}
                  iconBg={f26.reconciliation.matched ? "#e6f7f0" : "#fdecea"}
                  label="Challan Reconciliation"
                  value={f26.reconciliation.matched ? "Matched" : "Unreconciled"}
                />
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
              <p style={{ fontSize: "12.5px", color: "#475467", marginTop: 10 }}>{f26.note}</p>
              <p style={{ marginTop: 10 }}>
                <a
                  className="btn ghost sm"
                  href={`/api/proxy/v1/payroll/statutory/form26q?fy=${encodeURIComponent(fy)}&quarter=${quarter}&format=file`}
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

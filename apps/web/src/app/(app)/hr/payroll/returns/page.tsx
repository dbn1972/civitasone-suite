import { PageHeader, Card, StatGrid, StatCard, DataTable, EmptyState } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { QuarterLookupForm } from "./QuarterLookupForm";
import { ForceFileButton } from "./ForceFileButton";

type Quarter = "Q1" | "Q2" | "Q3" | "Q4";
const QUARTERS: Quarter[] = ["Q1", "Q2", "Q3", "Q4"];

type Deductee24Q = {
  employeeId: string;
  pan: string;
  panFlag: string;
  name: string;
  tdsDeducted: number;
  tdsDeposited: number;
  periods: string[];
};

type Form24Q = {
  formType: "24Q";
  fy: string;
  quarter: Quarter;
  deducteeCount: number;
  deductees: Deductee24Q[];
  totalTdsDeducted: number;
  totalTdsDeposited: number;
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

function currentFyQuarter(): { fy: string; quarter: Quarter } {
  const now = new Date();
  const y = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const fy = `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
  const m = now.getMonth() + 1; // 1-12
  const quarter: Quarter = m >= 4 && m <= 6 ? "Q1" : m >= 7 && m <= 9 ? "Q2" : m >= 10 && m <= 12 ? "Q3" : "Q4";
  return { fy, quarter };
}

const FY_RE = /^\d{4}-\d{2}$/;

async function getForm24Q(fy: string, quarter: Quarter, force: boolean): Promise<LoaderResult<Form24Q | null>> {
  const forceParam = force ? "&force=1" : "";
  return fetchJson<unknown, Form24Q | null>(
    `/api/v1/payroll/statutory/form24q?fy=${encodeURIComponent(fy)}&quarter=${quarter}${forceParam}`,
    null,
    {
      telemetryKey: "payroll.statutory.form24q",
      mapResponse: (p) => (p && typeof p === "object" ? (p as Form24Q) : null),
    },
  );
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

  const [{ data: f24, source: src24 }, { data: f26, source: src26 }] = await Promise.all([
    getForm24Q(fy, quarter, force),
    getForm26Q(fy, quarter),
  ]);

  const rows24 = (f24?.deductees ?? []).map((d) => ({ ...d }));
  const cols24: { key: keyof Deductee24Q & string; label: string; align?: "left" | "right"; cellType?: "status" }[] = [
    { key: "name", label: "Employee" },
    { key: "pan", label: "PAN" },
    { key: "tdsDeducted", label: "TDS Deducted (₹)", align: "right" },
    { key: "tdsDeposited", label: "TDS Deposited (₹)", align: "right" },
  ];

  const rows26 = (f26?.deductees ?? []).map((d) => ({ ...d }));
  const cols26: { key: keyof Deductee26Q & string; label: string; align?: "left" | "right" }[] = [
    { key: "name", label: "Deductee" },
    { key: "pan", label: "PAN" },
    { key: "section", label: "Section" },
    { key: "tdsDeductedMinor", label: "TDS Deducted (paise)", align: "right" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Quarterly TDS Returns"
        subtitle="Form-24Q (salary) and Form-26Q (non-salary) quarterly e-TDS returns."
        back="/hr/payroll"
      />

      <QuarterLookupForm defaultFy={fy} defaultQuarter={quarter} quarters={QUARTERS} />

      <Card title={`Form-24Q — Salary TDS — FY ${fy} ${quarter}`}>
        <div className="pad">
          {f24 === null ? (
            <>
              <EmptyState
                icon="🧾"
                title={`No Form-24Q data for FY ${fy} ${quarter}`}
                message={
                  force
                    ? "No approved/disbursed payroll runs contributed TDS in this quarter."
                    : "Either no approved/disbursed payroll runs exist for this quarter yet, or the return is blocked: TDS deducted does not match deposited challans (TRACES reconciliation gate)."
                }
              />
              {!force && (
                <ForceFileButton fy={fy} quarter={quarter} />
              )}
            </>
          ) : (
            <>
              {src24 === "error" && <DataSourceBadge source="error" />}
              <StatGrid>
                <StatCard icon="👥" iconBg="#e6f0ff" label="Deductees" value={f24.deducteeCount} />
                <StatCard icon="💰" iconBg="#e6f7f0" label="Total TDS Deducted (₹)" value={f24.totalTdsDeducted.toLocaleString("en-IN")} />
                <StatCard
                  icon={f24.reconciliation.matched ? "✅" : "⚠️"}
                  iconBg={f24.reconciliation.matched ? "#e6f7f0" : "#fdecea"}
                  label="Challan Reconciliation"
                  value={f24.reconciliation.matched ? "Matched" : "Unreconciled"}
                />
              </StatGrid>
              {f24.reconciliation.warning && (
                <p role="alert" className="pill bad" style={{ width: "fit-content", marginTop: 10 }}>
                  {f24.reconciliation.warning}
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
              <p style={{ fontSize: "12.5px", color: "#475467", marginTop: 10 }}>{f24.note}</p>
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
            <EmptyState
              icon="🧾"
              title={`No Form-26Q data for FY ${fy} ${quarter}`}
              message="Non-salary TDS requires a vendor/rent deduction feed writing to statutory.payroll_tds_nonsalary for this quarter."
            />
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

import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getReportJobById } from "../../../_data/loaders";
import { DataTable, EmptyState, PageHeader, RefreshErrorState, StatusPill } from "../../../_components/ds";
import { maskPan, maskAccount, maskPhone, maskEmail, maskLast4 } from "../../../_components/ds";
import { formatIndianDate, formatMoney, humanizeStatus } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";

/**
 * GAP-REPORTS-DETAIL-02: the report payload is a generic dump of arbitrary
 * columns from any module (HR, citizen, finance …). report-service does not
 * yet return per-column type/sensitivity metadata, so until it does we classify
 * columns web-side by name:
 *  - sensitive  → mask via the shared <Masked> (DPDP: Aadhaar/PAN/account/…);
 *  - money_paise → render through formatMoney (paise→₹, Indian grouping).
 * This is a conservative, fail-closed default: a column that merely *looks*
 * like an identifier is masked rather than printed raw. HUMAN REVIEW: a
 * legitimately non-sensitive column whose name matches (e.g. "account_name")
 * will also be masked — the real fix is backend column metadata.
 */
type ColKind = "text" | "money_paise" | "sensitive";

function classifyColumn(name: string): { kind: ColKind; maskKind?: "pan" | "account" | "phone" | "email" | "last4" } {
  const n = name.toLowerCase();
  if (/\b(aadhaar|aadhar|uid)\b|aadhaar|aadhar/.test(n)) return { kind: "sensitive", maskKind: "last4" };
  if (/pan(\b|_|number|no)/.test(n) || n === "pan") return { kind: "sensitive", maskKind: "pan" };
  if (/(account|acct|bank).*(no|num|number)?/.test(n) || /ifsc/.test(n)) return { kind: "sensitive", maskKind: "account" };
  if (/(mobile|phone|contact).*(no|num|number)?|^mobile$|^phone$/.test(n)) return { kind: "sensitive", maskKind: "phone" };
  if (/e-?mail/.test(n)) return { kind: "sensitive", maskKind: "email" };
  // Money columns are stored as integer paise end-to-end.
  if (/(amount|amt|total|balance|paise|salary|wage|fee|fine|tax|value_inr)(\b|_|$)/.test(n) && !/count/.test(n)) {
    return { kind: "money_paise" };
  }
  return { kind: "text" };
}

export default async function ReportDetailPage({ params }: { params: { id: string } }) {
  const { data: job, source, status } = await getReportJobById(params.id);

  // GAP-REPORTS-DETAIL-01: a transient fetch failure (500/outage) must NOT be
  // reported as "the ID is incorrect". Only a genuine 404 (or a successful
  // fetch that returned no job) is a not-found; any other error source renders
  // a retry state with honest "couldn't load" copy.
  if (source === "error" && status !== 404) {
    return (
      <div className="wrap">
        <DataSourceBadge source={source} />
        <PageHeader title="Report" back="/reports/list" />
        <RefreshErrorState error={toHumanError("load", { area: "report" })} backHref="/reports/list" />
      </div>
    );
  }

  if (!job) {
    return (
      <div className="wrap">
        <PageHeader title="Report not found" back="/reports/list" />
        <EmptyState icon="📋" title="Report job not found" message="The job may have been deleted or the ID is incorrect." />
      </div>
    );
  }

  const displayColumns = job.columns.length > 0
    ? job.columns
    : job.rows.length > 0
      ? Object.keys(job.rows[0])
      : [];

  const colKinds = new Map(displayColumns.map((c) => [c, classifyColumn(c)] as const));

  const visibleRows = job.rows.slice(0, 100);
  const totalRows = job.totalCount > 0 ? job.totalCount : job.rows.length;

  type DataRow = Record<string, unknown>;

  // GAP-REPORTS-DETAIL-02: pre-format every cell to a plain STRING here, in the
  // Server Component, rather than via a DataTable `render` callback — a render
  // function cannot cross the RSC → client-component boundary. Sensitive
  // columns are masked and money_paise columns are rendered as ₹ before the
  // value ever reaches the client table, so the clear value is never shipped.
  const tableRows: DataRow[] = visibleRows.map((row) => {
    const mapped: DataRow = {};
    for (const col of displayColumns) {
      mapped[col] = formatCell(colKinds.get(col)!, row[col]);
    }
    return mapped;
  });

  // GAP-REPORTS-DETAIL-05: distinguish a FAILED job from one still pending.
  const isFailed = job.status === "failed";
  const queueAgainHref = `/reports/list/new${job.module && job.module !== "general" ? `?reportType=${encodeURIComponent(job.module)}` : ""}`;
  return (
    <div className="wrap">
      <PageHeader
        title={job.reportName}
        subtitle={`${job.module} · Requested by ${job.requestedBy}`}
        back="/reports/list"
        actions={
          job.status === "completed" && job.downloadUrl ? (
            <a href={job.downloadUrl} target="_blank" rel="noopener noreferrer" className="btn primary">
              Download report
            </a>
          ) : undefined
        }
      />

      <div className="grid g-4" style={{ marginBottom: "18px" }}>
        <div className="card" style={{ padding: "16px" }}>
          <div className="lab">Status</div>
          <div className="val" style={{ marginTop: "6px" }}>
            <StatusPill status={job.status} />
          </div>
        </div>
        <div className="card" style={{ padding: "16px" }}>
          <div className="lab">Format</div>
          <div className="val" style={{ marginTop: "6px", textTransform: "uppercase", fontSize: "14px" }}>
            {job.format}
          </div>
        </div>
        <div className="card" style={{ padding: "16px" }}>
          <div className="lab">Requested at</div>
          <div className="val" style={{ marginTop: "6px", fontSize: "14px" }}>{formatIndianDate(job.requestedAt)}</div>
        </div>
        <div className="card" style={{ padding: "16px" }}>
          <div className="lab">Completed at</div>
          <div className="val" style={{ marginTop: "6px", fontSize: "14px" }}>{job.completedAt ? formatIndianDate(job.completedAt) : "—"}</div>
        </div>
      </div>

      {job.parameters && Object.keys(job.parameters).length > 0 && (
        <div className="card" style={{ marginBottom: "18px" }}>
          <div className="card-h"><h3>Parameters</h3></div>
          <div className="pad">
            <div className="fields">
              {Object.entries(job.parameters).map(([k, v]) => (
                <div className="field" key={k}>
                  <div className="lbl">{paramLabel(k)}</div>
                  <div className="val">{formatParamValue(k, v)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-h">
          <h3>Report data</h3>
          {displayColumns.length > 0 && (
            <span style={{ fontSize: "12px", color: "var(--mut)" }}>
              {visibleRows.length.toLocaleString("en-IN")} of {totalRows.toLocaleString("en-IN")} rows
            </span>
          )}
        </div>

        {/* GAP-REPORTS-DETAIL-03: when more rows exist than are shown inline,
            say so explicitly and give the download route (or explain why it is
            unavailable) rather than silently truncating at 100. */}
        {displayColumns.length > 0 && totalRows > visibleRows.length && (
          <div className="pad" style={{ paddingTop: 0 }}>
            <p style={{ fontSize: "13px", color: "var(--mut)", margin: 0 }}>
              Showing the first {visibleRows.length.toLocaleString("en-IN")} rows.{" "}
              {job.status === "completed" && job.downloadUrl ? (
                <>
                  <a href={job.downloadUrl} target="_blank" rel="noopener noreferrer" style={{ color: "var(--primary)" }}>
                    Download the full report
                  </a>{" "}
                  to see all {totalRows.toLocaleString("en-IN")} rows.
                </>
              ) : (
                <>The full file is not yet available for download (the report is {humanizeStatus(job.status)}).</>
              )}
            </p>
          </div>
        )}

        {displayColumns.length === 0 ? (
          isFailed ? (
            // GAP-REPORTS-DETAIL-05: a failed job must not say "data will be
            // available once the report completes". report-service does not
            // expose a per-job error reason, so the copy is honest-generic, and
            // a "Queue again" link re-opens the create form as a retry path.
            <EmptyState
              icon="⚠️"
              title="Report failed"
              message="This report job did not complete, so there is no data to show. You can queue it again."
              action={
                <Link
                  href={queueAgainHref}
                  className="btn primary"
                >
                  Queue again
                </Link>
              }
            />
          ) : (
            <EmptyState
              icon="📋"
              title={job.status === "completed" ? "No data columns" : "Pending"}
              message={job.status === "completed" ? "No data columns in this report." : "Data will be available once the report completes."}
            />
          )
        ) : (
          <DataTable<DataRow>
            columns={displayColumns.map((col) => ({ key: col as keyof DataRow & string, label: col }))}
            rows={tableRows}
            sortable
            filterable
            pageSize={15}
          />
        )}
      </div>
    </div>
  );
}

// GAP-REPORTS-DETAIL-02: format one cell to a display string by column kind.
// Sensitive values are masked (DPDP), money_paise are rendered via formatMoney
// (paise → ₹), everything else is stringified. Missing values render "—".
function formatCell(info: ReturnType<typeof classifyColumn>, raw: unknown): string {
  if (raw === null || raw === undefined || raw === "") return "—";
  if (info.kind === "money_paise") return formatMoney(raw as string | number);
  if (info.kind === "sensitive") {
    const v = String(raw);
    switch (info.maskKind) {
      case "pan": return maskPan(v);
      case "account": return maskAccount(v);
      case "phone": return maskPhone(v);
      case "email": return maskEmail(v);
      default: return maskLast4(v);
    }
  }
  return String(raw);
}

/**
 * GAP-REPORTS-DETAIL-04: parameters were printed with raw camelCase keys and
 * unformatted values (fromDate, departmentId UUID). Map known keys to labels,
 * humanize the rest, and format ISO/calendar-date values with formatIndianDate.
 */
const PARAM_LABELS: Record<string, string> = {
  fromDate: "From date",
  toDate: "To date",
  startDate: "Start date",
  endDate: "End date",
  departmentId: "Department",
  moduleId: "Module",
  period: "Period",
  financialYear: "Financial year",
  tenantId: "Tenant",
};

function paramLabel(key: string): string {
  return PARAM_LABELS[key] ?? humanizeStatus(key);
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(?:T[\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function formatParamValue(key: string, value: string): string {
  if (value === null || value === undefined || value === "") return "—";
  if (ISO_DATE_RE.test(value)) return formatIndianDate(value);
  // An id-shaped value with no name resolver available: show a short, honest
  // form rather than a bare UUID (no cross-service name lookup wired here).
  if (UUID_RE.test(value)) {
    const label = PARAM_LABELS[key] ?? humanizeStatus(key);
    return `${label} (ID …${value.slice(-6)})`;
  }
  return value;
}

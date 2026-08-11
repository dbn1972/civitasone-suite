import { PageHeader, StatGrid, StatCard, Card, StatusPill, EmptyState } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { formatIndianDate } from "@/lib/formatters";
import { statusAwareGet } from "../_lib/statusAwareFetch";
import { GenerateForm16Form } from "./GenerateForm16Form";
import { VerifyForm16Form } from "./VerifyForm16Form";
import { FyLookupForm } from "./FyLookupForm";

type BulkJob = {
  jobId: string;
  fy: string;
  status: string;
  totalEmployees: number;
  generated: number;
  failed: number;
  storagePrefix: string | null;
  errorDetails: unknown;
  createdAt: string;
  completedAt: string | null;
};

type JobLookup =
  | { state: "found"; job: BulkJob }
  /** GET .../bulk-status legitimately 404s when no job has been created for this FY yet. */
  | { state: "not_found" }
  /** Auth failure, 5xx, or malformed payload — a REAL error, must not look like "not found". */
  | { state: "error" };

/** FY runs Apr–Mar; before April we're still in the FY that started last calendar year. */
function currentFy(): string {
  const now = new Date();
  const y = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
}

const FY_RE = /^\d{4}-\d{2}$/;

async function getBulkStatus(fy: string): Promise<JobLookup> {
  const r = await statusAwareGet(`/v1/payroll/tax/form16/bulk-status?fy=${encodeURIComponent(fy)}`);
  if (r.kind === "ok") {
    const d = (r.body as { data?: BulkJob } | null)?.data;
    return d && typeof d === "object" ? { state: "found", job: d } : { state: "error" };
  }
  if (r.kind === "http_error" && r.status === 404) return { state: "not_found" };
  return { state: "error" };
}

export default async function Form16Page({
  searchParams,
}: {
  searchParams: { fy?: string };
}) {
  const fy = searchParams.fy && FY_RE.test(searchParams.fy) ? searchParams.fy : currentFy();
  const lookup = await getBulkStatus(fy);

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Form-16 Generation"
        subtitle="Generate, track, and verify statutory Form-16 (Sec 203) certificates for a financial year."
        back="/hr/payroll"
      />

      {/* Single-employee generate reuses the same async bulk-generate/bulk-status job
          machinery as a whole-run bulk job (with employeeIds:[id]) — there is no separate
          synchronous single-issue endpoint, so both paths are tracked identically below. */}
      <GenerateForm16Form defaultFy={fy} />

      <Card title={`Bulk Filing Run — FY ${fy}`}>
        <div className="pad">
          <FyLookupForm defaultFy={fy} />

          {/* NOTE: the payroll-service does not expose a "list all Form-16 jobs" endpoint —
              /v1/payroll/tax/form16/bulk-status only returns the single job for one FY at a
              time, so this view queries one financial year per lookup rather than listing rows. */}
          {lookup.state === "not_found" ? (
            <EmptyState
              icon="🧾"
              title={`No Form-16 filing run for FY ${fy}`}
              message="Use “Generate Form-16” above to start a single-employee or whole-run bulk job for this financial year."
            />
          ) : lookup.state === "error" ? (
            <>
              <DataSourceBadge source="error" />
              <EmptyState
                icon="⚠️"
                title={`Could not load the Form-16 filing run for FY ${fy}`}
                message="The status check failed. Please reload the page, or contact an administrator if this persists."
              />
            </>
          ) : (
            <>
              <StatGrid>
                <StatCard icon="👥" iconBg="#e6f0ff" label="Total Employees" value={lookup.job.totalEmployees} />
                <StatCard icon="✅" iconBg="#e6f7f0" label="Generated" value={lookup.job.generated} />
                <StatCard icon="⚠️" iconBg="#fdecea" label="Failed" value={lookup.job.failed} />
              </StatGrid>
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginTop: 12 }}>
                <span style={{ fontSize: 13 }}>
                  <strong>Job:</strong> <span className="mono">{lookup.job.jobId}</span>
                </span>
                <StatusPill status={lookup.job.status} />
                <span style={{ fontSize: 13, color: "#667085" }}>
                  Created {formatIndianDate(lookup.job.createdAt)}
                  {lookup.job.completedAt ? ` · Completed ${formatIndianDate(lookup.job.completedAt)}` : ""}
                </span>
              </div>
              {lookup.job.status === "completed" && lookup.job.storagePrefix && (
                <p style={{ fontSize: 13, marginTop: 10 }}>
                  <a
                    className="btn ghost sm"
                    href={`/api/proxy/v1/payroll/tax/form16/bulk-download?fy=${encodeURIComponent(fy)}`}
                  >
                    <span aria-hidden="true">⬇</span> Get download link
                  </a>
                </p>
              )}
              {lookup.job.failed > 0 && lookup.job.errorDetails != null && (
                <details style={{ marginTop: 10, fontSize: 13 }}>
                  <summary>Failure details ({lookup.job.failed})</summary>
                  <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, background: "#f8fafc", padding: 10, borderRadius: 8 }}>
                    {JSON.stringify(lookup.job.errorDetails, null, 2)}
                  </pre>
                </details>
              )}
            </>
          )}
        </div>
      </Card>

      <VerifyForm16Form />
    </main>
  );
}

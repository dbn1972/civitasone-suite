import { PageHeader, StatGrid, StatCard, Card, StatusPill, EmptyState } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { formatIndianDate } from "@/lib/formatters";
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

/** FY runs Apr–Mar; before April we're still in the FY that started last calendar year. */
function currentFy(): string {
  const now = new Date();
  const y = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
}

const FY_RE = /^\d{4}-\d{2}$/;

async function getBulkStatus(fy: string): Promise<LoaderResult<BulkJob | null>> {
  return fetchJson<unknown, BulkJob | null>(
    `/api/v1/payroll/tax/form16/bulk-status?fy=${encodeURIComponent(fy)}`,
    null,
    {
      telemetryKey: "payroll.form16.bulk-status",
      mapResponse: (p) => {
        const d = (p as { data?: BulkJob } | null)?.data;
        return d && typeof d === "object" ? d : null;
      },
    },
  );
}

export default async function Form16Page({
  searchParams,
}: {
  searchParams: { fy?: string };
}) {
  const fy = searchParams.fy && FY_RE.test(searchParams.fy) ? searchParams.fy : currentFy();
  const { data: job, source } = await getBulkStatus(fy);

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Form-16 Generation"
        subtitle="Generate, track, and verify statutory Form-16 (Sec 203) certificates for a financial year."
        back="/hr/payroll"
      />

      <GenerateForm16Form defaultFy={fy} />

      <Card title={`Bulk Filing Run — FY ${fy}`}>
        <div className="pad">
          <FyLookupForm defaultFy={fy} />

          {/* NOTE: the payroll-service does not expose a "list all Form-16 jobs" endpoint —
              /v1/payroll/tax/form16/bulk-status only returns the single job for one FY at a
              time, so this view queries one financial year per lookup rather than listing rows. */}
          {job === null ? (
            <EmptyState
              icon="🧾"
              title={`No Form-16 filing run for FY ${fy}`}
              message="Use “Generate Form-16” above to start a single-employee or whole-run bulk job for this financial year."
            />
          ) : (
            <>
              {source === "error" && <DataSourceBadge source="error" />}
              <StatGrid>
                <StatCard icon="👥" iconBg="#e6f0ff" label="Total Employees" value={job.totalEmployees} />
                <StatCard icon="✅" iconBg="#e6f7f0" label="Generated" value={job.generated} />
                <StatCard icon="⚠️" iconBg="#fdecea" label="Failed" value={job.failed} />
              </StatGrid>
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginTop: 12 }}>
                <span style={{ fontSize: 13 }}>
                  <strong>Job:</strong> <span className="mono">{job.jobId}</span>
                </span>
                <StatusPill status={job.status} />
                <span style={{ fontSize: 13, color: "#667085" }}>
                  Created {formatIndianDate(job.createdAt)}
                  {job.completedAt ? ` · Completed ${formatIndianDate(job.completedAt)}` : ""}
                </span>
              </div>
              {job.status === "completed" && job.storagePrefix && (
                <p style={{ fontSize: 13, marginTop: 10 }}>
                  <a
                    className="btn ghost sm"
                    href={`/api/proxy/v1/payroll/tax/form16/bulk-download?fy=${encodeURIComponent(fy)}`}
                  >
                    <span aria-hidden="true">⬇</span> Get download link
                  </a>
                </p>
              )}
              {job.failed > 0 && job.errorDetails != null && (
                <details style={{ marginTop: 10, fontSize: 13 }}>
                  <summary>Failure details ({job.failed})</summary>
                  <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, background: "#f8fafc", padding: 10, borderRadius: 8 }}>
                    {JSON.stringify(job.errorDetails, null, 2)}
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

import { PageHeader, StatGrid, StatCard, Card, StatusPill, EmptyState } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { formatIndianDate } from "@/lib/formatters";
import { statusAwareGet } from "../_lib/statusAwareFetch";
import { VerifyForm16Form } from "./VerifyForm16Form";
import { FyLookupForm } from "./FyLookupForm";
import { Form16Wizard } from "./Form16Wizard";

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
  | { state: "not_found" }
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

  const source: "api" | "error" = lookup.state === "error" ? "error" : "api";

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Form-16 Generation"
        subtitle="Generate, review deductions, and issue statutory Form-16 (Sec 203) certificates."
        back="/hr/payroll"
      />
      <DataSourceBadge source={source} message="Couldn't load — showing nothing" />

      {/* Wizard: 3-step — select FY / review deductions / generate & download */}
      <Card title="Form-16 Wizard">
        <Form16Wizard defaultFy={fy} />
      </Card>

      <Card title={`Bulk Filing Status — FY ${fy}`}>
        <div className="pad">
          <FyLookupForm defaultFy={fy} />

          {lookup.state === "not_found" ? (
            <EmptyState
              icon="🧾"
              title={`No Form-16 run for FY ${fy}`}
              message="Use the wizard above to start a single-employee or bulk generation job."
            />
          ) : lookup.state === "error" ? (
            <>
              <DataSourceBadge source="error" message="Couldn't load — showing nothing" />
              <EmptyState
                icon="⚠️"
                title={`Could not load filing run for FY ${fy}`}
                message="The status check failed. Please reload the page or contact an administrator."
              />
            </>
          ) : (
            <>
              <StatGrid>
                <StatCard icon="👥" iconBg="var(--infobg)" label="Total Employees" value={lookup.job.totalEmployees} />
                <StatCard icon="✅" iconBg="var(--goodbg)" label="Generated" value={lookup.job.generated} />
                <StatCard icon="⚠️" iconBg="var(--badbg)" label="Failed" value={lookup.job.failed} />
                <StatCard
                  icon="⏳"
                  iconBg="var(--warnbg)"
                  label="Pending"
                  value={Math.max(0, lookup.job.totalEmployees - lookup.job.generated - lookup.job.failed)}
                />
              </StatGrid>
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginTop: 12 }}>
                <span style={{ fontSize: 13 }}>
                  <strong>Job:</strong> <span className="mono">{lookup.job.jobId}</span>
                </span>
                <StatusPill status={lookup.job.status} />
                <span style={{ fontSize: 13, color: "var(--color-text-muted)" }}>
                  Created {formatIndianDate(lookup.job.createdAt)}
                  {lookup.job.completedAt ? " · Completed " + formatIndianDate(lookup.job.completedAt) : ""}
                </span>
              </div>
              {lookup.job.status === "completed" && lookup.job.storagePrefix && (
                <p style={{ fontSize: 13, marginTop: 10 }}>
                  <a
                    className="btn ghost sm"
                    href={"/api/proxy/v1/payroll/tax/form16/bulk-download?fy=" + encodeURIComponent(fy)}
                  >
                    <span aria-hidden="true">⬇</span> Get download link
                  </a>
                </p>
              )}
              {lookup.job.failed > 0 && lookup.job.errorDetails != null && (
                <details style={{ marginTop: 10, fontSize: 13 }}>
                  <summary>Failure details ({lookup.job.failed})</summary>
                  <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, background: "var(--line2)", padding: 10, borderRadius: 8 }}>
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

import { getTranslations } from "next-intl/server";
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
    // REL-023: an unconfigured/empty backend response for this endpoint comes
    // back as `{ data: [] }` (an array), not a 404 -- `typeof [] === "object"`
    // and `[]` is truthy, so the old check let that array through as if it
    // were a real BulkJob. Every field read off it downstream (jobId, status,
    // ...) was then `undefined`, and <StatusPill status={undefined}> crashes
    // in status.toLowerCase() -- taking down the whole page (so even the
    // always-rendered PageHeader never painted). Require a real object.
    return d && typeof d === "object" && !Array.isArray(d)
      ? { state: "found", job: d as BulkJob }
      : { state: "error" };
  }
  if (r.kind === "http_error" && r.status === 404) return { state: "not_found" };
  return { state: "error" };
}

export default async function Form16Page({
  searchParams,
}: {
  searchParams: { fy?: string };
}) {
  const t = await getTranslations("form16");
  // FyLookupForm stays a plain synchronous component (see its own file for
  // why) so its copy is resolved here and passed down as props.
  const tFyLookup = await getTranslations("fyLookupForm");
  const fy = searchParams.fy && FY_RE.test(searchParams.fy) ? searchParams.fy : currentFy();
  const lookup = await getBulkStatus(fy);

  const source: "api" | "error" = lookup.state === "error" ? "error" : "api";

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr/payroll" backLabel="Back to Payroll"
      />
      <DataSourceBadge source={source} message={t("loadErrorMessage")} />

      {/* Wizard: 3-step — select FY / review deductions / generate & download */}
      <Card title={t("wizardCardTitle")}>
        <Form16Wizard defaultFy={fy} />
      </Card>

      <Card title={t("bulkStatusCardTitle", { fy })}>
        <div className="pad">
          <FyLookupForm
            defaultFy={fy}
            financialYearLabel={tFyLookup("financialYearLabel")}
            checkRunLabel={tFyLookup("checkRunBtn")}
            formatHint={tFyLookup("formatHint")}
          />

          {lookup.state === "not_found" ? (
            <EmptyState
              icon="🧾"
              title={t("notFoundTitle", { fy })}
              message={t("notFoundMessage")}
            />
          ) : lookup.state === "error" ? (
            <EmptyState
              icon="⚠️"
              title={t("errorStateTitle", { fy })}
              message={t("errorStateMessage")}
            />
          ) : (
            <>
              <StatGrid>
                <StatCard icon="👥" iconBg="var(--infobg)" label={t("statTotalEmployees")} value={lookup.job.totalEmployees} />
                <StatCard icon="✅" iconBg="var(--goodbg)" label={t("statGenerated")} value={lookup.job.generated} />
                <StatCard icon="⚠️" iconBg="var(--badbg)" label={t("statFailed")} value={lookup.job.failed} />
                <StatCard
                  icon="⏳"
                  iconBg="var(--warnbg)"
                  label={t("statPending")}
                  value={Math.max(0, lookup.job.totalEmployees - lookup.job.generated - lookup.job.failed)}
                />
              </StatGrid>
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginTop: 12 }}>
                <span style={{ fontSize: 13 }}>
                  <strong>{t("jobLabel")}</strong> <span className="mono">{lookup.job.jobId}</span>
                </span>
                <StatusPill status={lookup.job.status} />
                <span style={{ fontSize: 13, color: "var(--color-text-muted)" }}>
                  {t("createdLabel", { date: formatIndianDate(lookup.job.createdAt) })}
                  {lookup.job.completedAt ? t("completedLabel", { date: formatIndianDate(lookup.job.completedAt) }) : ""}
                </span>
              </div>
              {lookup.job.status === "completed" && lookup.job.storagePrefix && (
                <p style={{ fontSize: 13, marginTop: 10 }}>
                  <a
                    className="btn ghost sm"
                    href={"/api/proxy/v1/payroll/tax/form16/bulk-download?fy=" + encodeURIComponent(fy)}
                  >
                    <span aria-hidden="true">⬇</span> {t("downloadLinkLabel")}
                  </a>
                </p>
              )}
              {lookup.job.failed > 0 && lookup.job.errorDetails != null && (
                <details style={{ marginTop: 10, fontSize: 13 }}>
                  <summary>{t("failureDetailsSummary", { count: lookup.job.failed })}</summary>
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
    </div>
  );
}

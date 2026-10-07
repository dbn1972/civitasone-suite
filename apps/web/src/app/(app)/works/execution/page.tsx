import Link from "next/link";
import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { getExecutionIssues, getExecutionProgress } from "../_data/loaders";
import { progressBucket } from "../_data/format";
import { ExecutionTable } from "./ExecutionTable";

export default async function ExecutionPage() {
  const [{ data: progress, source: progressSource }, { data: issues, source: issuesSource }] =
    await Promise.all([getExecutionProgress(), getExecutionIssues()]);

  const progressFailed = progressSource === "error";
  const issuesFailed = issuesSource === "error";

  // GAP-WORKS-EXECUTION-03: five mutually-exclusive buckets (see
  // progressBucket) so the cards always sum to the Progress-Entries total —
  // no row counted twice (100% was both On Track and Completed) and no row
  // counted nowhere (50–79% and exactly-0% rows previously vanished).
  const counts = progress.reduce(
    (acc, p) => {
      acc[progressBucket(Number(p.percentage ?? 0))] += 1;
      return acc;
    },
    { completed: 0, onTrack: 0, inProgress: 0, atRisk: 0, notStarted: 0 },
  );
  const total = progress.length;
  const openIssues = issues.filter((i) => i.status === "open").length;

  // GAP-WORKS-EXECUTION-02: on a fetch failure show "—" (StatCard renders
  // null as a dash), never a fabricated 0 that contradicts cached rows. A
  // progress failure blanks the four progress-derived cards; an issues
  // failure blanks only the Open-Issues card — the two fetches are
  // independent and must not drag each other down.
  const statOrNull = (failed: boolean, value: number) => (failed ? null : value);

  return (
    <div className="page-main wrap">
      <PageHeader
        title="Execution & Progress"
        subtitle="Scope progress monitoring, photos, and issue tracking."
        back="/works"
        actions={
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Link
              href="/works/execution/record-progress"
              className="btn primary"
              style={{ minHeight: 36, fontSize: 13, padding: "6px 14px" }}
            >
              + Record progress
            </Link>
          </div>
        }
      />
      <StatGrid>
        <StatCard icon="🏗️" iconBg="#eff6ff" label="Progress Entries" value={statOrNull(progressFailed, total)} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="On Track" value={statOrNull(progressFailed, counts.onTrack)} />
        <StatCard icon="⚠️" iconBg="#fffaeb" label="At Risk" value={statOrNull(progressFailed, counts.atRisk)} />
        <StatCard icon="🎉" iconBg="#f0fdf4" label="Completed" value={statOrNull(progressFailed, counts.completed)} />
        <StatCard icon="🚧" iconBg="#fef2f2" label="Open Issues" value={statOrNull(issuesFailed, openIssues)} />
      </StatGrid>
      <Card title="Execution Progress">
        <ExecutionTable
          progress={progress}
          issues={issues}
          progressSource={progressFailed ? "error" : "api"}
          issuesSource={issuesFailed ? "error" : "api"}
        />
      </Card>
    </div>
  );
}

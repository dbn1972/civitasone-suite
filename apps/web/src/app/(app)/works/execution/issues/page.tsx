import Link from "next/link";
import { PageHeader, Card, StatGrid, StatCard } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { fetchJson } from "@/app/_data/apiClient";
import { formatIndianDate } from "@/lib/formatters";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { canCloseIssue } from "@/lib/auth/workRoles";
import { IssuesTable, type IssuesTableRow } from "./IssuesTable";

interface IssueApiRow {
  id: string;
  workId: string;
  workNumber?: string | null;
  issueTypeId?: string;
  description: string;
  raisedDate?: string;
  status: string;
}

interface IssuesResponse {
  data: IssueApiRow[];
  meta?: { total?: number };
}

function shortId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

export default async function IssuesRegisterPage() {
  const canClose = canCloseIssue(getSessionRoles());

  const response = await fetchJson<unknown, { rows: IssueApiRow[]; total: number }>(
    "/api/v1/works/execution/issues?pageSize=100",
    { rows: [], total: 0 },
    {
      telemetryKey: "works.issues.list",
      mapResponse: (raw: unknown) => {
        if (Array.isArray(raw)) return { rows: raw as IssueApiRow[], total: (raw as IssueApiRow[]).length };
        const typed = raw as IssuesResponse;
        const rows = typed.data ?? [];
        return { rows, total: typed.meta?.total ?? rows.length };
      },
    },
  );

  const issues = response.data.rows;
  const total = response.data.total;

  const totalCount = total;
  const openCount = issues.filter((i) => i.status === "open").length;
  const closedCount = issues.filter((i) => i.status !== "open").length;

  // GAP-WORKS-EXECUTION-ISSUES-02/03: carry workId + a Work label, keep the
  // full description (DataTable clamps + title), no Priority (dead column).
  const rows: IssuesTableRow[] = issues.map((issue) => ({
    id: issue.id,
    workId: issue.workId,
    work: issue.workNumber || (issue.workId ? shortId(issue.workId) : "—"),
    description: issue.description,
    raisedDate: issue.raisedDate ? formatIndianDate(issue.raisedDate) : "—",
    status: issue.status,
  }));

  const truncated = total > issues.length;

  return (
    <div className="page-main wrap">
      <PageHeader
        title="Issues Register"
        subtitle="All field issues across works."
        back="/works"
        actions={
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {response.source === "error" && (
              <DataSourceBadge source="error" message="Couldn't load issues — the list may be incomplete." />
            )}
            <Link
              href="/works/execution/issues/new"
              className="btn primary"
              style={{ minHeight: 36, fontSize: 13, padding: "6px 14px" }}
            >
              + Raise issue
            </Link>
          </div>
        }
      />

      <StatGrid>
        <StatCard icon="📋" label="Total Issues" value={response.source === "error" ? null : totalCount} />
        <StatCard icon="⚠️" iconBg="var(--warnbg, #fef3c7)" label="Open" value={response.source === "error" ? null : openCount} />
        <StatCard icon="✅" iconBg="var(--goodbg, #ecfdf3)" label="Closed" value={response.source === "error" ? null : closedCount} />
      </StatGrid>

      {truncated && (
        <p style={{ fontSize: 12, color: "var(--muted)", margin: "0 0 8px" }}>
          Showing the first {issues.length} of {total} issues.
        </p>
      )}

      <Card title="Issues">
        <IssuesTable rows={rows} canClose={canClose} />
      </Card>
    </div>
  );
}

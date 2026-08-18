import { PageHeader, Card, DataTable, StatGrid, StatCard } from "@/app/_components/ds";
import { fetchJson } from "@/app/_data/apiClient";
import { formatIndianDate } from "@/lib/formatters";
import { IssueCloseForm } from "./IssueCloseForm";

interface IssueRow {
  id: string;
  workId: string;
  issueTypeId?: string;
  description: string;
  raisedDate?: string;
  status: string;
  priority?: string;
}

interface IssuesResponse {
  data: IssueRow[];
}

const columns = [
  { key: "shortId", label: "ID" },
  { key: "description", label: "Description" },
  { key: "priority", label: "Priority" },
  { key: "raisedDate", label: "Raised" },
  { key: "status", label: "Status" },
];

export default async function IssuesRegisterPage() {
  const response = await fetchJson<unknown, IssueRow[]>(
    "/api/v1/works/execution/issues?pageSize=100",
    [],
    {
      telemetryKey: "works.issues.list",
      mapResponse: (raw: unknown) => {
        if (Array.isArray(raw)) return raw as IssueRow[];
        const typed = raw as IssuesResponse;
        return typed.data ?? [];
      },
    }
  );

  const issues: IssueRow[] = response.data ?? [];

  const totalCount = issues.length;
  const openCount = issues.filter((i) => i.status === "open").length;
  const closedCount = issues.filter((i) => i.status !== "open").length;

  const rows = issues.map((issue) => ({
    id: issue.id,
    shortId: issue.id.slice(0, 8),
    description: issue.description.slice(0, 80),
    priority: issue.priority ?? "—",
    raisedDate: issue.raisedDate ? formatIndianDate(issue.raisedDate) : "—",
    status: issue.status,
  }));

  return (
    <>
      <PageHeader
        title="Issues Register"
        subtitle="All field issues across works."
        back="/works"
      />
      <div
        style={{
          padding: "24px 32px",
          display: "flex",
          flexDirection: "column",
          gap: 24,
        }}
      >
        <StatGrid>
          <StatCard label="Total Issues" value={totalCount} />
          <StatCard label="Open" value={openCount} />
          <StatCard label="Closed" value={closedCount} />
        </StatGrid>

        <Card title="Issues">
          <DataTable columns={columns} rows={rows} />
        </Card>

        <Card title="Close Issue">
          <IssueCloseForm />
        </Card>
      </div>
    </>
  );
}

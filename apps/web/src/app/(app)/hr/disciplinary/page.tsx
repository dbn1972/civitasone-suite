import Link from "next/link";
import { PageHeader, StatGrid, StatCard, Card, DataTable } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";

type RawRow = {
  id: string;
  employee: string;
  department: string;
  proceeding_type: string;
  charges: string;
  filed_date: string;
  inquiry_officer: string;
  status: string;
} & Record<string, unknown>;

type Row = RawRow & { caseRef: string; type: string };

async function getData(): Promise<LoaderResult<RawRow[]>> {
  return fetchJson<unknown, RawRow[]>("/api/v1/hrms/disciplinary-cases", [], {
    telemetryKey: "hr.disciplinary",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: RawRow[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

export default async function DisciplinaryListPage() {
  const { data: rawItems, source } = await getData();
  const items: Row[] = rawItems.map((r) => ({
    ...r,
    caseRef: (r.proceeding_type === "major" ? "VIG/" : "GRV/") + r.id.slice(0, 8).toUpperCase(),
    type: r.proceeding_type === "major" ? "Major (Vigilance)" : "Minor (Grievance)",
  }));

  const major = items.filter((i) => i.proceeding_type === "major").length;
  const minor = items.filter((i) => i.proceeding_type === "minor").length;
  const open = items.filter((i) => !["closed", "disposed", "finalised"].includes(i.status)).length;

  const columns: { key: keyof Row & string; label: string; cellType?: "status" }[] = [
    { key: "caseRef", label: "Case Ref" },
    { key: "employee", label: "Employee" },
    { key: "department", label: "Department" },
    { key: "type", label: "Proceeding Type" },
    { key: "charges", label: "Charge / Grievance" },
    { key: "inquiry_officer", label: "IO / HR Officer" },
    { key: "filed_date", label: "Filed" },
    { key: "status", label: "Status", cellType: "status" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Disciplinary Cases"
        subtitle="All departmental proceedings — major vigilance cases and minor grievances in one view."
        back="/hr"
        actions={<Link href="/hr/vigilance" className="btn-outline">Vigilance Only</Link>}
      />
      <DataSourceBadge source={source} message="Couldn't load — showing nothing" />
      <StatGrid>
        <StatCard icon="⚖️" iconBg="#e6f0ff" label="Total Cases" value={items.length} />
        <StatCard icon="🔴" iconBg="#fff1f0" label="Major (Vigilance)" value={major} />
        <StatCard icon="🟡" iconBg="#fffbe6" label="Minor (Grievance)" value={minor} />
        <StatCard icon="📋" iconBg="#f5f5f5" label="Active / Open" value={open} />
      </StatGrid>
      <Card title="All Disciplinary Cases">
        <DataTable<Row>
          columns={columns}
          rows={items}
          sortable
          filterable
          filterPlaceholder="Filter by employee, department or charge…"
          pageSize={15}
          emptyIcon="⚖️"
          emptyTitle="No disciplinary cases on record"
          emptyMessage="All departmental proceedings under CCS (CCA) Rules appear here — both major vigilance cases (charge memo / inquiry) and minor proceedings."
        />
      </Card>
    </main>
  );
}

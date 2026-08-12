import Link from "next/link";
import { PageHeader, Card, StatGrid, StatCard, EmptyState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { DesignationsTable } from "./DesignationsTable";

type Designation = { id: string; code: string; name: string; level: number; payGrade: string | null } & Record<string, unknown>;

async function getDesignations(): Promise<LoaderResult<Designation[]>> {
  try {
    const r = await fetchJson<unknown, Designation[]>("/api/v1/hrms/designations", [], {
      telemetryKey: "config.designations",
      mapResponse: (p) => (p as { data: Designation[] })?.data ?? null,
    });
    return r;
  } catch {
    return { data: [], source: "error" as const };
  }
}

const newBtnStyle: React.CSSProperties = {
  minHeight: 40,
  padding: "0 16px",
  display: "flex",
  alignItems: "center",
  borderRadius: 8,
  fontWeight: 600,
  fontSize: 14,
  background: "var(--primary)",
  color: "#fff",
  textDecoration: "none",
};

export default async function DesignationsPage() {
  const { data: items, source } = await getDesignations();

  const withPayGrade    = items.filter((d) => !!d.payGrade).length;
  const withoutPayGrade = items.filter((d) => !d.payGrade).length;
  const uniqueLevels    = new Set(items.map((d) => String(d.level))).size;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Designations"
        subtitle="Job titles and pay levels used across your office — Clerk, Officer, DDO, etc."
        back="/hr"
        backLabel="HR"
        help="hr"
        actions={
          <Link href="/hr/designations/new" style={newBtnStyle}>
            + New Designation
          </Link>
        }
      />
      <DataSourceBadge source={source} />
      <StatGrid>
        <StatCard icon="🏅" iconBg="#e6f0ff" label="Total Designations" value={items.length} />
        <StatCard icon="💰" iconBg="#e6f7f0" label="With Pay Grade"     value={withPayGrade} />
        <StatCard icon="—" iconBg="#fff7e6" label="Without Pay Grade"  value={withoutPayGrade} />
        <StatCard icon="🎚️" iconBg="#f5f5f5" label="Unique Levels"      value={uniqueLevels} />
      </StatGrid>

      <Card title={`Designations (${items.length})`}>
        {items.length === 0 ? (
          <EmptyState
            icon="🏷️"
            title="No designations yet"
            message="Add your first designation so employees can be given a proper job title."
          />
        ) : (
          <DesignationsTable items={items} />
        )}
      </Card>
    </main>
  );
}

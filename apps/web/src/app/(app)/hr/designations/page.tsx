import Link from "next/link";
import { PageHeader, Card, StatGrid, StatCard, EmptyState, RefreshErrorState } from "../../../_components/ds";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { useResource } from "@/app/_data/useResource";
import { toHumanError } from "@/lib/messages";
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
  const result = await getDesignations();
  const { data: items } = result;
  const resource = useResource(result);
  const errored = resource.status === "error";

  const withPayGrade    = errored ? null : items.filter((d) => !!d.payGrade).length;
  const withoutPayGrade = errored ? null : items.filter((d) => !d.payGrade).length;
  const uniqueLevels    = errored ? null : new Set(items.map((d) => String(d.level))).size;

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
      <StatGrid>
        <StatCard icon="🏅" iconBg="#e6f0ff" label="Total Designations" value={errored ? "—" : items.length} />
        <StatCard icon="💰" iconBg="#e6f7f0" label="With Pay Grade"     value={withPayGrade ?? "—"} />
        <StatCard icon="—" iconBg="#fff7e6" label="Without Pay Grade"  value={withoutPayGrade ?? "—"} />
        <StatCard icon="🎚️" iconBg="#f5f5f5" label="Unique Levels"      value={uniqueLevels ?? "—"} />
      </StatGrid>

      <Card title={errored ? "Designations" : `Designations (${items.length})`}>
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "designations" })} backHref="/hr" />
          </div>
        ) : items.length === 0 ? (
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

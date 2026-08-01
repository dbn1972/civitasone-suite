import Link from "next/link";
import { PageHeader, StatCard, StatGrid, Card } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { getInspections, getInspectionAssignments, getInspectionCapas } from "./_data/loaders";

export const dynamic = "force-dynamic";

const LINKS = [
  { href: "/inspection/inspections", title: "Inspections", desc: "Execution records and history." },
  { href: "/inspection/assignments", title: "Assignments", desc: "Inspector assignments and tour plans." },
  { href: "/inspection/capa", title: "CAPA", desc: "Corrective and preventive actions." },
];

export default async function InspectionHubPage() {
  const [inspections, assignments, capas] = await Promise.all([
    getInspections(),
    getInspectionAssignments(),
    getInspectionCapas(),
  ]);
  const source =
    inspections.source === "error" || assignments.source === "error" || capas.source === "error"
      ? "error"
      : "api";

  return (
    <main className="wrap">
      <PageHeader
        title="Inspection"
        subtitle="Plans, assignments, execution and CAPA — wired to inspection-service APIs."
      />
      {source === "error" && <DataSourceBadge source={source} />}
      <StatGrid>
        <StatCard icon="🔎" iconBg="#eff6ff" label="Inspections" value={String(inspections.data.length)} />
        <StatCard icon="👷" iconBg="#ecfdf5" label="Assignments" value={String(assignments.data.length)} />
        <StatCard icon="🛠️" iconBg="#fff7ed" label="CAPA" value={String(capas.data.length)} />
      </StatGrid>
      <div className="grid" style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", marginTop: 18 }}>
        {LINKS.map((c) => (
          <Link key={c.href} href={c.href} style={{ textDecoration: "none", color: "inherit" }}>
            <Card padding>
              <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>{c.title}</h3>
              <p style={{ fontSize: 13.5, color: "var(--ink2)", lineHeight: 1.5 }}>{c.desc}</p>
              <div className="lnk" style={{ marginTop: 12 }}>Open →</div>
            </Card>
          </Link>
        ))}
      </div>
    </main>
  );
}

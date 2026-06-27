import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatCard } from "../../../_components/ds";
import { getLegalCases } from "../../../_data/loaders";
import { LegalCasesTable } from "./LegalCasesTable";

export default async function LegalCasesListPage() {
  const { data: items, source } = await getLegalCases();

  const active = items.filter((i) => i.status === "pending").length;
  const courts = new Set(items.map((i) => i.court)).size;
  const disposed = items.filter((i) => i.status === "disposed").length;
  const adverseRisk = items.filter((i) => i.type === "writ" || i.type === "criminal").length;

  return (
    <div className="wrap">
      <PageHeader
        title="Legal Cases"
        subtitle="Track litigation across courts & tribunals."
        actions={
          <>
            <Link href="/legal/hearings" className="btn ghost">Cause list</Link>
            <Link href="/legal/cases/new" className="btn primary">+ New Case</Link>
          </>
        }
      />
      <div className="grid g-4" style={{ marginBottom: 18 }}>
        <StatCard icon="📁" iconBg="#f1f5f9" label="Active Cases" value={active} />
        <StatCard icon="🏛️" iconBg="#eff6ff" label="Courts / Fora" value={courts} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Disposed (FY)" value={disposed} />
        <StatCard icon="⚠️" iconBg="#fef3f2" label="Adverse Risk" value={adverseRisk} />
      </div>
      {source === "error" && <DataSourceBadge source={source} />}
      <LegalCasesTable items={items} source={source} />
    </div>
  );
}

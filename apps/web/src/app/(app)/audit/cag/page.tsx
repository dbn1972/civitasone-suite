import { PageHeader, StatGrid, StatCard, Card, EmptyState } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { getCagParas } from "@/app/_data/loaders";
import { CagTable } from "./CagTable";

export default async function CagPage() {
  const { data: paras, source } = await getCagParas();

  const totalParas = paras.reduce((sum, p) => sum + p.totalParas, 0);
  const settled = paras.reduce((sum, p) => sum + p.settled, 0);
  const pending = paras.reduce((sum, p) => sum + p.pending, 0);
  const departments = new Set(paras.map((p) => p.department)).size;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="CAG Audit Interaction"
        subtitle="Comptroller and Auditor General audit paragraphs and settlement tracking."
        back="/audit"
      />
      <DataSourceBadge source={source} />

      <StatGrid>
        <StatCard icon="📜" iconBg="#eef2ff" label="Total Paras" value={totalParas} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Settled" value={settled} />
        <StatCard icon="⏳" iconBg="#fffaeb" label="Pending" value={pending} />
        <StatCard icon="🏛️" iconBg="#fce7ee" label="Departments" value={departments} />
      </StatGrid>

      {paras.length === 0 ? (
        <Card title="CAG Audit Paragraphs">
          <EmptyState
            icon="📜"
            title="No CAG paragraphs found"
            message="CAG audit paragraphs will appear here once reported by the audit team."
          />
        </Card>
      ) : (
        <Card title="CAG Audit Paragraphs">
          <CagTable rows={paras} source={source} />
        </Card>
      )}
    </main>
  );
}

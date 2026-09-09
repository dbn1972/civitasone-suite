import { PageHeader, StatGrid, StatCard, Card, EmptyState, RefreshErrorState } from "@/app/_components/ds";
import { getCagParas } from "@/app/_data/loaders";
import { useResource } from "@/app/_data/useResource";
import { toHumanError } from "@/lib/messages";
import { CagTable } from "./CagTable";

export default async function CagPage() {
  const result = await getCagParas();
  const { data: paras, source } = result;
  const resource = useResource(result);
  const errored = resource.status === "error";

  const totalParas = errored ? null : paras.reduce((sum, p) => sum + p.totalParas, 0);
  const settled = errored ? null : paras.reduce((sum, p) => sum + p.settled, 0);
  const pending = errored ? null : paras.reduce((sum, p) => sum + p.pending, 0);
  const departments = errored ? null : new Set(paras.map((p) => p.department)).size;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="CAG Audit Interaction"
        subtitle="Comptroller and Auditor General audit paragraphs and settlement tracking."
        back="/audit"
      />

      <StatGrid>
        <StatCard icon="📜" iconBg="#eef2ff" label="Total Paras" value={totalParas ?? "—"} />
        <StatCard icon="✅" iconBg="var(--goodbg)" label="Settled" value={settled ?? "—"} />
        <StatCard icon="⏳" iconBg="var(--warnbg)" label="Pending" value={pending ?? "—"} />
        <StatCard icon="🏛️" iconBg="#fce7ee" label="Departments" value={departments ?? "—"} />
      </StatGrid>

      {errored ? (
        <Card title="CAG Audit Paragraphs">
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "CAG audit paragraphs" })} backHref="/audit" />
          </div>
        </Card>
      ) : paras.length === 0 ? (
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

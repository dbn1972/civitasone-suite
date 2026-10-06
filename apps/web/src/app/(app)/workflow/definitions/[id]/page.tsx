import { PageHeader, Card, StatCard, StatGrid, StatusPill, EmptyState, RefreshErrorState } from "../../../../_components/ds";
import { notFound } from "next/navigation";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { toHumanError } from "@/lib/messages";
import { DefinitionGraph } from "../../_components/DefinitionGraph";
import { getDefinitionById } from "../../_data/workflowData";

export default async function DefinitionDetailPage({ params }: { params: { id: string } }) {
  const { data: def, source, status } = await getDefinitionById(params.id);

  // GAP-WORKFLOW-DEFINITIONS-DETAIL-02/03 — a 404 (incl. a bad/invalid id,
  // which the loader also maps to 404) is a genuine "not found", not a load
  // failure. Render the dedicated not-found page; keep the retryable error
  // state for any other failure.
  if (!def && status === 404) {
    notFound();
  }

  if (!def) {
    return (
      <>
        <PageHeader title="Definition" back="/workflow/definitions" actions={source === "error" ? <DataSourceBadge source={source} /> : null} />
        <Card>
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "definition" })} backHref="/workflow/definitions" />
          </div>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={def.name}
        subtitle={def.description ?? `Process ${def.code}, version ${def.version}`}
        back="/workflow/definitions"
        actions={
          <>
            <StatusPill status={def.status} />
            {/* GAP-WORKFLOW-DEFINITIONS-DETAIL-01 — open this definition in the
                designer (loads via ?definitionId=) and jump to its instances. */}
            <a href={`/workflow/designer?definitionId=${encodeURIComponent(def.id)}`} className="btn ghost sm">
              Open in Designer
            </a>
            <a href={`/workflow/list?definitionId=${encodeURIComponent(def.id)}`} className="btn ghost sm">
              View instances
            </a>
            {source === "error" ? <DataSourceBadge source={source} /> : null}
          </>
        }
      />

      <StatGrid>
        <StatCard icon="🔖" iconBg="#eef2ff" label="Code" value={def.code} />
        <StatCard icon="#️⃣" iconBg="#f5f3ff" label="Version" value={def.version} />
        <StatCard icon="◻" iconBg="#ecfdf5" label="Nodes" value={def.nodes.length} />
        <StatCard icon="→" iconBg="#fff7ed" label="Transitions" value={def.edges.length} />
      </StatGrid>

      <div style={{ marginTop: 18 }}>
        <Card title="Process graph" padding>
          {def.nodes.length === 0 ? ( // ux-001-ok: `def` is only reachable past the earlier `if (!def) return` guard above (source==="error" implies a null def per the loader contract) -- this is a genuinely node-free definition, never a masked fetch failure
            <EmptyState icon="◻" title="No nodes" message="This definition has no nodes yet." />
          ) : (
            <DefinitionGraph nodes={def.nodes} edges={def.edges} />
          )}
        </Card>
      </div>
    </>
  );
}

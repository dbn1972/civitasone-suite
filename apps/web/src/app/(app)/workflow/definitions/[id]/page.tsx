import { PageHeader, Card, StatCard, StatGrid, StatusPill, EmptyState } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { Breadcrumbs } from "../../_components/Breadcrumbs";
import { DefinitionGraph } from "../../_components/DefinitionGraph";
import { getDefinitionById } from "../../_data/workflowData";

export default async function DefinitionDetailPage({ params }: { params: { id: string } }) {
  const { data: def, source } = await getDefinitionById(params.id);

  if (!def) {
    return (
      <>
        <Breadcrumbs
          items={[
            { label: "Workflow", href: "/workflow" },
            { label: "Definitions", href: "/workflow/definitions" },
            { label: "Not found" },
          ]}
        />
        <PageHeader title="Definition" back="/workflow/definitions" actions={source === "error" ? <DataSourceBadge source={source} /> : null} />
        <EmptyState
          icon="📐"
          title={source === "error" ? "Could not load definition" : "Definition not found"}
          message={
            source === "error"
              ? "The workflow service did not return this definition. Check that you are signed in and the service is reachable."
              : "This definition may have been removed or the ID is invalid."
          }
        />
      </>
    );
  }

  return (
    <>
      <Breadcrumbs
        items={[
          { label: "Workflow", href: "/workflow" },
          { label: "Definitions", href: "/workflow/definitions" },
          { label: def.name },
        ]}
      />
      <PageHeader
        title={def.name}
        subtitle={def.description ?? `Process ${def.code}, version ${def.version}`}
        back="/workflow/definitions"
        actions={
          <>
            <StatusPill status={def.status} />
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
          {def.nodes.length === 0 ? (
            <EmptyState icon="◻" title="No nodes" message="This definition has no nodes yet." />
          ) : (
            <DefinitionGraph nodes={def.nodes} edges={def.edges} />
          )}
        </Card>
      </div>
    </>
  );
}

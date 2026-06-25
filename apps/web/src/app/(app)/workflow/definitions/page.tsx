import { Suspense } from "react";
import { PageHeader, StatCard, StatGrid, Card, EmptyState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { Breadcrumbs } from "../_components/Breadcrumbs";
import { DefinitionsTable } from "../_components/DefinitionsTable";
import { getDefinitions } from "../_data/workflowData";

export default async function DefinitionsPage() {
  const { data: definitions, source } = await getDefinitions();

  const active = definitions.filter((d) => d.status === "active").length;
  const draft = definitions.filter((d) => d.status === "draft").length;
  const codes = new Set(definitions.map((d) => d.code)).size;

  return (
    <>
      <Breadcrumbs items={[{ label: "Workflow", href: "/workflow" }, { label: "Definitions" }]} />
      <PageHeader
        title="Workflow definitions"
        subtitle="Process definitions and their versions. Open a definition to inspect its node graph and transitions."
        back="/workflow"
        actions={source === "error" ? <DataSourceBadge source={source} /> : null}
      />

      <StatGrid>
        <StatCard icon="📐" iconBg="#eef2ff" label="Definitions" value={definitions.length} />
        <StatCard icon="🔖" iconBg="#f5f3ff" label="Distinct processes" value={codes} />
        <StatCard icon="✅" iconBg="#ecfdf5" label="Active" value={active} />
        <StatCard icon="✏️" iconBg="#fff7ed" label="Draft" value={draft} />
      </StatGrid>

      <div style={{ marginTop: 18 }}>
        <Card title="Definitions">
          {source === "error" ? (
            <div className="pad">
              <EmptyState
                icon="⚠️"
                title="Could not load definitions"
                message="The workflow service did not return definitions. Check that you are signed in and the service is reachable."
              />
            </div>
          ) : definitions.length === 0 ? (
            <div className="pad">
              <EmptyState icon="📐" title="No definitions yet" message="Deployed workflow definitions will appear here." />
            </div>
          ) : (
            <div className="pad">
              <Suspense fallback={null}>
                <DefinitionsTable definitions={definitions} />
              </Suspense>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

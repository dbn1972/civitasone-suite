import { PageHeader, Card, DataTable, EmptyState, StatGrid, StatCard, RefreshErrorState } from "../../../_components/ds";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { combineResourceState } from "@/app/_data/useResource";
import { toHumanError } from "@/lib/messages";

type Definition = {
  id: string;
  name: string;
  module?: string;
  triggerEvent?: string;
  steps?: number;
  status: string;
  version?: number;
} & Record<string, unknown>;

async function getDefinitions(): Promise<LoaderResult<Definition[]>> {
  return fetchJson<unknown, Definition[]>("/api/v1/workflow/definitions", [], {
    telemetryKey: "workflow.definitions",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: Definition[] })?.data;
      return Array.isArray(arr) ? arr as Definition[] : null;
    },
  });
}

async function getTemplates(): Promise<LoaderResult<Definition[]>> {
  return fetchJson<unknown, Definition[]>("/api/v1/workflow/templates", [], {
    telemetryKey: "workflow.templates",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: Definition[] })?.data;
      return Array.isArray(arr) ? arr as Definition[] : null;
    },
  });
}

export default async function WorkflowDefinitionsPage() {
  const [definitionsResult, templatesResult] = await Promise.all([getDefinitions(), getTemplates()]);
  const definitions = definitionsResult.data;
  const templates = templatesResult.data;
  // getDefinitions()/getTemplates() used to return only r.data, discarding
  // LoaderResult's source entirely — a failure on either endpoint was
  // indistinguishable from a tenant with zero workflows configured. Combine
  // both sources: either one erroring means the page genuinely could not
  // load, not that there is nothing to show (UX-001).
  const resource = combineResourceState(
    [definitionsResult, templatesResult],
    definitions,
    (d) => d.length === 0,
  );
  const errored = resource.status === "error";
  const active = errored ? null : definitions.filter((d) => d.status === "active" || d.status === "deployed").length;

  return (
    <main className="page-main" aria-labelledby="page-heading">
      <PageHeader
        title="Approval Workflows"
        subtitle="Configure who approves what — set up approval chains for bills, leave, procurement, and other actions."
        back="/workflow"
        backLabel="Workflow"
      />

      <StatGrid>
        <StatCard icon="🔁" iconBg="#e7edfd" label="Total Workflows" value={errored ? "—" : definitions.length} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Active" value={active ?? "—"} />
        <StatCard icon="📋" iconBg="#fffaeb" label="Templates" value={errored ? "—" : templates.length} />
      </StatGrid>

      <Card title="Your approval workflows">
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "approval workflows" })} backHref="/workflow" />
          </div>
        ) : definitions.length === 0 ? (
          <EmptyState
            icon="🔁"
            title="No approval workflows configured"
            message="Set up your first workflow to route approvals based on amount, department, or type. Start from a template below."
          />
        ) : (
          <DataTable<Definition>
            columns={[
              { key: "name", label: "Workflow Name" },
              { key: "module", label: "Module" },
              { key: "triggerEvent", label: "Trigger" },
              { key: "status", label: "Status", cellType: "status" },
            ]}
            rows={definitions}
            rowLinkKey="id"
            rowLinkPrefix="/workflow/definitions/"
            sortable
            filterable
            exportable
            filterPlaceholder="Search workflows…"
          />
        )}
      </Card>

      {!errored && templates.length > 0 && (
        <Card title="Templates (ready to use)">
          <div className="pad">
            <p style={{ color: "var(--mut)", fontSize: 13.5, marginBottom: 12 }}>
              Clone a template to get started quickly — then customise the approval steps for your office.
            </p>
            <DataTable<Definition>
              columns={[
                { key: "name", label: "Template" },
                { key: "module", label: "Module" },
                { key: "steps", label: "Steps" },
              ]}
              rows={templates}
              sortable
            />
          </div>
        </Card>
      )}
    </main>
  );
}

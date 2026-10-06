import { PageHeader, Card, DataTable, EmptyState, StatGrid, StatCard, RefreshErrorState } from "../../../_components/ds";
import Link from "next/link";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { combineResourceState } from "@/app/_data/useResource";
import { toHumanError } from "@/lib/messages";
import { TemplatesTable, type TemplateRow } from "../_components/TemplatesTable";

// GAP-WORKFLOW-DEFINITIONS-02 — the workflow-service definitions list
// (GET /v1/workflow/definitions, repo.findByTenant) returns the definitions
// table columns: id, code, name, description, version, status, isTemplate.
// There is NO `module`, `triggerEvent` or `steps` column anywhere in the
// schema (services/workflow-service/.../definitions/schema.ts), so the old
// Module/Trigger/Steps columns rendered permanently blank. The type below is
// aligned to the real contract; extra keys stay optional (never required).
type Definition = {
  id: string;
  code?: string;
  name: string;
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
    <div className="page-main" aria-labelledby="page-heading">
      <PageHeader
        title="Approval Workflows"
        subtitle="Configure who approves what — set up approval chains for bills, leave, procurement, and other actions."
        back="/workflow"
        backLabel="Workflow"
        actions={
          <Link href="/workflow/designer" className="btn primary sm">
            New workflow
          </Link>
        }
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
            message="Set up your first workflow to route approvals based on amount, department, or type. Use a template below or start a new workflow in the designer."
          />
        ) : (
          <DataTable<Definition>
            columns={[
              { key: "name", label: "Workflow Name" },
              { key: "code", label: "Code" },
              { key: "version", label: "Version", align: "right" },
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
              Use a template to get started quickly — it creates an editable draft in your tenant that you can customise for your office.
            </p>
            <TemplatesTable templates={templates as TemplateRow[]} />
          </div>
        </Card>
      )}
    </div>
  );
}

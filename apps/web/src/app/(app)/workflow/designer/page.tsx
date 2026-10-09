import { PageHeader } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getDesignerDefinitions } from "./_data/designerData";
import { DesignerCanvas } from "./_components/DesignerCanvasClient";
import { getSessionRoles, WORKFLOW_DESIGNER_AUTHOR_ROLES } from "@/lib/auth/roleGuard";

export default async function WorkflowDesignerPage({
  searchParams,
}: {
  searchParams?: { definitionId?: string };
}) {
  const { data: definitions, source } = await getDesignerDefinitions();
  const initialDefinitionId = searchParams?.definitionId;

  // GAP2-DESIGNER-HOME-01 — only workflow authors see the Save control. The
  // canvas stays usable as a read-only viewer (open a draft, validate) for
  // officer roles; workflow-service's designer routes remain the authority.
  const canAuthor = WORKFLOW_DESIGNER_AUTHOR_ROLES.some((r) => getSessionRoles().includes(r));

  return (
    <div className="page-main">
      <PageHeader
        title="BPMN Designer"
        subtitle="Visual drag-and-drop workflow designer — model business processes with BPMN 2.0 elements."
        back="/workflow"
        backLabel="Workflow"
        actions={source === "error" ? <DataSourceBadge source={source} /> : null}
      />
      <DesignerCanvas definitions={definitions} canAuthor={canAuthor} {...(initialDefinitionId ? { initialDefinitionId } : {})} />
    </div>
  );
}

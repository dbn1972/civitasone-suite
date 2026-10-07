import { PageHeader } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getDesignerDefinitions } from "./_data/designerData";
import { DesignerCanvas } from "./_components/DesignerCanvasClient";

export default async function WorkflowDesignerPage({
  searchParams,
}: {
  searchParams?: { definitionId?: string };
}) {
  const { data: definitions, source } = await getDesignerDefinitions();
  const initialDefinitionId = searchParams?.definitionId;

  return (
    <div className="page-main">
      <PageHeader
        title="BPMN Designer"
        subtitle="Visual drag-and-drop workflow designer — model business processes with BPMN 2.0 elements."
        back="/workflow"
        backLabel="Workflow"
        actions={source === "error" ? <DataSourceBadge source={source} /> : null}
      />
      <DesignerCanvas definitions={definitions} {...(initialDefinitionId ? { initialDefinitionId } : {})} />
    </div>
  );
}

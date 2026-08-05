import { PageHeader } from "../../../_components/ds";
import { PipelineEditor } from "../../../_components/crm/PipelineEditor";

/** OP-002 admin — pipelines and per-stage mandatory fields, gates and scope. */
export default function Page() {
  return (
    <>
      <PageHeader
        title="Sales Pipelines"
        subtitle="Define pipelines and, per stage, the mandatory fields, gates and product/region/business-unit scope that govern how opportunities progress."
        back="/crm"
        backLabel="CRM"
      />
      <PipelineEditor />
    </>
  );
}

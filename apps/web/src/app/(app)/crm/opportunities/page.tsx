import { PageHeader } from "../../../_components/ds";
import { OpportunityViews } from "../../../_components/crm/OpportunityViews";

/** OP-004 — Kanban board, list, calendar and funnel views over the pipeline. */
export default function Page() {
  return (
    <>
      <PageHeader
        title="Opportunities"
        subtitle="Work the pipeline as a board, list, close-date calendar or funnel. Move cards between stages and close won/lost."
        back="/crm"
        backLabel="CRM"
        actions={<a className="btn primary" href="/crm/opportunities/new">+ New opportunity</a>}
      />
      <OpportunityViews />
    </>
  );
}

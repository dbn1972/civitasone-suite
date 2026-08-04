import { PageHeader } from "../../../_components/ds";
import { DataQualityView } from "../../../_components/crm/DataQualityView";

/** DQ-004 — Data Quality dashboard. */
export default function Page() {
  return (
    <>
      <PageHeader
        title="Data Quality"
        subtitle="Completeness, format and freshness of the contact, lead and account masters."
        back="/crm"
        backLabel="CRM"
        actions={<a className="btn ghost" href="/crm/dedup-rules">Matching rules</a>}
      />
      <DataQualityView />
    </>
  );
}

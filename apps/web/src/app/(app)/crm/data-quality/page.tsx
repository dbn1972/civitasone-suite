import { PageHeader } from "../../../_components/ds";
import { DataQualityView } from "../../../_components/crm/DataQualityView";

/** DQ-004 — Data Quality dashboard. */
export default function Page() {
  return (
    <>
      <PageHeader
        title="Data Quality • डेटा गुणवत्ता"
        subtitle="Completeness, format and freshness of the contact, account and stakeholder masters — ensuring data integrity for GoI reporting"
        back="/crm"
        backLabel="CRM"
        actions={<a className="btn ghost" href="/crm/dedup-rules">Matching rules</a>}
      />
      <div
        role="note"
        aria-label="Data quality context"
        className="flex items-start gap-2.5 mt-4 px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800"
      >
        <span>
          Regular data quality checks ensure accurate reporting for Ministry dashboards and RTI disclosures.
        </span>
      </div>
      <DataQualityView />
    </>
  );
}

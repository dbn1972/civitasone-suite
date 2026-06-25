import { PageHeader } from "../../../../_components/ds";
import { getLegalCases } from "../../../../_data/loaders";
import { RecordOrderForm } from "./RecordOrderForm";

export default async function RecordOrderPage() {
  const { data: cases } = await getLegalCases();
  const options = cases.map((c) => ({ id: c.id, label: `${c.caseNo} · ${c.title}` }));

  return (
    <div className="wrap">
      <PageHeader
        title="Record Court Order"
        subtitle="Record a court order or judgment against a case for compliance tracking."
        back="/legal/court-orders"
      />
      <RecordOrderForm cases={options} />
    </div>
  );
}

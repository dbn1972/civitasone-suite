import { PageHeader, RefreshErrorState } from "../../../../_components/ds";
import { toHumanError } from "@/lib/messages";
import { getLegalCases } from "../../../../_data/loaders";
import { RecordOrderForm } from "./RecordOrderForm";

export default async function RecordOrderPage() {
  const { data: cases, source } = await getLegalCases();
  const options = cases.map((c) => ({ id: c.id, label: `${c.caseNo} · ${c.title}` }));

  return (
    <div className="wrap">
      <PageHeader
        title="Record Court Order"
        subtitle="Record a court order or judgment against a case for compliance tracking."
        back="/legal/court-orders"
      />
      {/* GAP-LEGAL-COURT-ORDERS-NEW-02: a failed cases fetch must NOT look like
          an empty register (which steers the user to register duplicates). */}
      {source === "error" ? (
        <RefreshErrorState
          error={toHumanError("load", { area: "cases" })}
          backHref="/legal/court-orders"
        />
      ) : (
        <RecordOrderForm cases={options} />
      )}
    </div>
  );
}

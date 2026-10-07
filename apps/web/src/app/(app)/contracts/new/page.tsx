import { PageHeader } from "../../../_components/ds";
import { getVendorOptions } from "../../../_data/loaders";
import { NewContractForm } from "./NewContractForm";

export default async function NewContractPage() {
  // GAP-CONTRACTS-NEW-01: load the vendor master server-side (cross-service
  // HTTP read) and hand it to the picker. A fetch failure is non-fatal — the
  // picker simply has no options to search (the clerk still cannot submit
  // without a valid selection), never a crash.
  const vendorsRes = await getVendorOptions();
  const vendors = vendorsRes.source === "api" ? vendorsRes.data : [];

  return (
    <div className="page-main" aria-labelledby="page-heading">
      <PageHeader
        title="New Contract"
        subtitle="Register a new service, supply, or maintenance contract."
        back="/contracts/list"
      />
      <NewContractForm vendors={vendors} />
    </div>
  );
}

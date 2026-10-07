import { PageHeader } from "../../../../../../_components/ds";
import { getSessionName, getSessionUserId } from "@/lib/auth/roleGuard";
import { getProcurementGRNById } from "../../../../../../_data/loaders";
import { CreateSrnForm } from "./CreateSrnForm";

export default async function NewSrnPage({ params }: { params: { id: string } }) {
  // GAP-PROCUREMENT-GRN-DETAIL-SRN-NEW-04 — show the signed-in officer's display
  // name (falling back to a short id hint, then "You"), never a raw JWT `sub`
  // UUID. The authoritative officer is still set server-side from the session.
  const name = getSessionName();
  const sub = getSessionUserId();
  const officerLabel = name ?? (sub ? `Officer (…${sub.slice(-6)})` : "You");

  // GAP-PROCUREMENT-GRN-DETAIL-SRN-NEW-02 — show the GRN's items/quantities being
  // accepted above the form so the officer sees what they are certifying.
  const { data: grn } = await getProcurementGRNById(params.id);
  const items = (grn?.items ?? []).map((i) => ({
    itemCode: i.itemCode,
    unit: i.unit,
    receivedQty: i.receivedQty,
    acceptedQty: i.acceptedQty,
  }));

  return (
    <>
      <PageHeader
        title="New Store Receipt Note"
        subtitle="GFR Rule 149 — confirms physical acceptance of the GRN into store."
        back={`/procurement/grn/${params.id}`}
      />
      <CreateSrnForm
        grnId={params.id}
        storeOfficerLabel={officerLabel}
        grnNo={grn?.grnNo}
        items={items}
      />
    </>
  );
}

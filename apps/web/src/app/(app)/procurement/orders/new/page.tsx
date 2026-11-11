import { PageHeader } from "../../../../_components/ds";
import { fetchJson } from "@/app/_data/apiClient";
import { CreatePOForm } from "./CreatePOForm";

// M10: a tenant without the Finance module (local approval mode) needs no budget sanction on a PO.
// Any other answer, or none, leaves the form exactly as it was.
async function isLocalApproval(): Promise<boolean> {
  const r = await fetchJson<unknown, boolean>("/api/v1/procurement/po-approval-settings", false, {
    telemetryKey: "procurement.poApproval.mode",
    mapResponse: (p) => (p as { mode?: unknown } | null)?.mode === "local",
  });
  return r.source === "api" && r.data === true;
}

export default async function NewPOPage() {
  const localApproval = await isLocalApproval();
  return (
    <>
      <PageHeader
        title="New Purchase Order"
        subtitle="Issue a PO — it enters the procurement approval workflow before dispatch."
        back="/procurement/orders"
      />
      <CreatePOForm localApproval={localApproval} />
    </>
  );
}

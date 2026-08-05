import { PageHeader } from "../../../../_components/ds";
import { CampaignDetail } from "../_components/CampaignDetail";

/** MK-001 / MK-004 — a single campaign: fields, metrics dashboard, send/cancel. */
export default function Page({ params }: { params: { id: string } }) {
  return (
    <>
      <PageHeader
        title="Campaign"
        subtitle="Campaign details, delivery metrics and ROI, with send and cancel actions."
        back="/notifications/campaigns"
        backLabel="Campaigns"
      />
      <CampaignDetail campaignId={params.id} />
    </>
  );
}

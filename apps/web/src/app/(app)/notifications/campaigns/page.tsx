import { PageHeader } from "../../../_components/ds";
import { CampaignList } from "./_components/CampaignList";

/** MK-001 — marketing campaigns: lifecycle, budget and ROI. */
export default function Page() {
  return (
    <>
      <PageHeader
        title="Campaigns"
        subtitle="Plan marketing campaigns against an audience segment, send them, and track delivery and ROI."
        back="/notifications"
        backLabel="Notifications"
      />
      <CampaignList />
    </>
  );
}

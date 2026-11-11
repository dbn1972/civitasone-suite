import { gigwMetadata, renderGigwPage } from "../_gigw/renderGigwPage";

// UAT gigw-content (GIGW 3.0): content contribution, moderation and approval policy (CMAP). Content: _gigw/gigwContent.ts.
export function generateMetadata() {
  return gigwMetadata("content-contribution-policy");
}

export default async function ContentContributionPolicyPage() {
  return renderGigwPage("content-contribution-policy");
}

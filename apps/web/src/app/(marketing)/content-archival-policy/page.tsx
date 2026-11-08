import { gigwMetadata, renderGigwPage } from "../_gigw/renderGigwPage";

// UAT gigw-content (GIGW 3.0): content archival policy. Content: _gigw/gigwContent.ts.
export function generateMetadata() {
  return gigwMetadata("content-archival-policy");
}

export default async function ContentArchivalPolicyPage() {
  return renderGigwPage("content-archival-policy");
}

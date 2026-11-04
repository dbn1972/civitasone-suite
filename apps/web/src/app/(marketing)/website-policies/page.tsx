import { gigwMetadata, renderGigwPage } from "../_gigw/renderGigwPage";

// UAT-P2-D3 (A11Y-19, GIGW 3.0): website policies (umbrella page). Content: _gigw/gigwContent.ts.
export function generateMetadata() {
  return gigwMetadata("website-policies");
}

export default async function WebsitePoliciesPage() {
  return renderGigwPage("website-policies");
}

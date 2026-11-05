import { gigwMetadata, renderGigwPage } from "../_gigw/renderGigwPage";

// UAT gigw-content (GIGW 3.0): content review policy. Content: _gigw/gigwContent.ts.
export function generateMetadata() {
  return gigwMetadata("content-review-policy");
}

export default async function ContentReviewPolicyPage() {
  return renderGigwPage("content-review-policy");
}

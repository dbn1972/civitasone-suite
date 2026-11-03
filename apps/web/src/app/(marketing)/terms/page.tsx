import { gigwMetadata, renderGigwPage } from "../_gigw/renderGigwPage";

// UAT post-b14 (GIGW 3.0): alias of /terms-and-conditions (same page, canonical URL in metadata).
export function generateMetadata() {
  return gigwMetadata("terms-and-conditions", "/terms-and-conditions");
}

export default async function TermsPage() {
  return renderGigwPage("terms-and-conditions");
}

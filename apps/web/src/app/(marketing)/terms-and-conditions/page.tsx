import { gigwMetadata, renderGigwPage } from "../_gigw/renderGigwPage";

// UAT post-b14 (GIGW 3.0): public page, content in _gigw/gigwContent.ts.
export function generateMetadata() {
  return gigwMetadata("terms-and-conditions");
}

export default async function TermsAndConditionsPage() {
  return renderGigwPage("terms-and-conditions");
}

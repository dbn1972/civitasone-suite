import { gigwMetadata, renderGigwPage } from "../_gigw/renderGigwPage";

// UAT post-b14 (GIGW 3.0): public page, content in _gigw/gigwContent.ts.
export function generateMetadata() {
  return gigwMetadata("hyperlink-policy");
}

export default async function HyperlinkPolicyPage() {
  return renderGigwPage("hyperlink-policy");
}

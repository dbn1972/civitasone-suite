import { gigwMetadata, renderGigwPage } from "../_gigw/renderGigwPage";

// UAT post-b14 (GIGW 3.0): alias of /privacy-policy (same page, canonical URL in metadata).
export function generateMetadata() {
  return gigwMetadata("privacy-policy", "/privacy-policy");
}

export default async function PrivacyPage() {
  return renderGigwPage("privacy-policy");
}

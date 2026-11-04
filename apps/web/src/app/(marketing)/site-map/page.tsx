import { gigwMetadata, renderGigwPage } from "../_gigw/renderGigwPage";

// UAT post-b14 (GIGW 3.0): alias of /sitemap (same page, canonical URL in metadata).
export function generateMetadata() {
  return gigwMetadata("sitemap", "/sitemap");
}

export default async function SiteMapPage() {
  return renderGigwPage("sitemap");
}

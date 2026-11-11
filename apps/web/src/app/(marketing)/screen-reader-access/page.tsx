import { gigwMetadata, renderGigwPage } from "../_gigw/renderGigwPage";

// UAT-P2-D3 (A11Y-19, GIGW 3.0): screen reader access. Content: _gigw/gigwContent.ts.
export function generateMetadata() {
  return gigwMetadata("screen-reader-access");
}

export default async function ScreenReaderAccessPage() {
  return renderGigwPage("screen-reader-access");
}

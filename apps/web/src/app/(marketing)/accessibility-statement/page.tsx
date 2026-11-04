import { gigwMetadata, renderGigwPage } from "../_gigw/renderGigwPage";

// UAT-P2-D3 (A11Y-19, GIGW 3.0): accessibility statement. Content: _gigw/gigwContent.ts.
export function generateMetadata() {
  return gigwMetadata("accessibility-statement");
}

export default async function AccessibilityStatementPage() {
  return renderGigwPage("accessibility-statement");
}

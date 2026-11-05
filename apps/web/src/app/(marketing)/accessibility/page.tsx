import type { Metadata } from "next";
import AccessibilityStatementPage, { generateMetadata as targetMetadata } from "../accessibility-statement/page";

// UAT post-b14 (GIGW 3.0): alias of /accessibility-statement (same page, canonical URL in metadata).
export async function generateMetadata(): Promise<Metadata> {
  return { ...(await targetMetadata()), alternates: { canonical: "/accessibility-statement" } };
}

export default AccessibilityStatementPage;

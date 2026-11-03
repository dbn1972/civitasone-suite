import type { Metadata } from "next";
import WebsitePoliciesPage, { generateMetadata as targetMetadata } from "../website-policies/page";

// UAT post-b14 (GIGW 3.0): alias of /website-policies (same page, canonical URL in metadata).
export async function generateMetadata(): Promise<Metadata> {
  return { ...(await targetMetadata()), alternates: { canonical: "/website-policies" } };
}

export default WebsitePoliciesPage;

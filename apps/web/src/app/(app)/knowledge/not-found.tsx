import Link from "next/link";
import { EmptyState } from "@/app/_components/ds";

// GAP-KNOWLEDGE-HOME-03: notFound() (e.g. from policies/[id]) used to render a
// bare EmptyState with no way back. Give the user explicit navigation and an
// honest message that covers the "no longer have access" case.
export default function KnowledgeNotFound() {
  return (
    <EmptyState
      title="Page not found"
      message="This document or page does not exist or you no longer have access."
      action={
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
          <Link href="/knowledge" className="btn primary" style={{ minHeight: 44 }}>
            Back to Knowledge
          </Link>
          <Link href="/knowledge/policies" className="btn ghost" style={{ minHeight: 44 }}>
            SOPs &amp; Policies
          </Link>
        </div>
      }
    />
  );
}

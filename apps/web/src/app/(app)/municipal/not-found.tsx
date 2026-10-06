import Link from "next/link";
import { EmptyState } from "@/app/_components/ds";

// GAP-MUNICIPAL-SERVICEKEY-05: a notFound() from a municipal segment (unknown
// serviceKey, or a bad id resolved to a 404) now shows a municipal-scoped
// not-found with a clear way back to the hub, instead of the generic root
// app/not-found.tsx that has no back link.
export default function MunicipalNotFound() {
  return (
    <EmptyState
      icon="🔎"
      title="Service not found"
      message="This municipal service does not exist or is no longer available."
      action={
        <Link href="/municipal" className="btn ghost" style={{ marginTop: 12 }}>
          Back to Municipal Services
        </Link>
      }
    />
  );
}

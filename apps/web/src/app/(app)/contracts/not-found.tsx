import Link from "next/link";
import { EmptyState } from "@/app/_components/ds";

// GAP-CONTRACTS-HOME-01 / HOME-03: a bad URL under /contracts (or any deep
// unknown segment) previously showed this EmptyState with no way back,
// stranding the user. EmptyState supports an `action` slot — give it a link
// back to the Contracts hub.
export default function ContractsNotFound() {
  return (
    <EmptyState
      title="Page not found"
      message="The page you are looking for does not exist or has been moved."
      action={
        <Link href="/contracts" className="btn primary" style={{ minHeight: 44, display: "inline-flex", alignItems: "center" }}>
          Back to Contracts
        </Link>
      }
    />
  );
}

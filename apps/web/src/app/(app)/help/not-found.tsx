import Link from "next/link";
import { EmptyState } from "@/app/_components/ds";

/**
 * Not-found for the Help Centre segment (GAP-HELP-MODULE-04). An unknown guide
 * slug previously fell through to the root "404 — Page not found" with no way
 * back; this gives a scoped message and a link to the Help Centre.
 */
export default function HelpNotFound() {
  return (
    <section className="page-main wrap">
      <EmptyState
        title="Guide not found"
        message="We couldn't find that guide. It may have been renamed or is not available yet."
        action={
          <Link href="/help" className="btn primary">
            Back to Help Centre
          </Link>
        }
      />
    </section>
  );
}

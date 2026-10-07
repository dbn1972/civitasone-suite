import Link from "next/link";
import { EmptyState } from "../../../../_components/ds";

export default function LegalCaseNotFound() {
  return (
    <div className="wrap">
      <nav
        aria-label="Breadcrumb"
        style={{ fontSize: 13, color: "var(--ink2)", marginBottom: 4 }}
      >
        <Link href="/legal" className="lnk">Legal</Link>
        <span aria-hidden="true" style={{ margin: "0 7px", color: "#cdd2dc" }}>/</span>
        <Link href="/legal/list" className="lnk">Cases</Link>
        <span aria-hidden="true" style={{ margin: "0 7px", color: "#cdd2dc" }}>/</span>
        <span aria-current="page">Not found</span>
      </nav>
      <EmptyState
        icon="⚖️"
        title="Case not found"
        message="This case may have been removed, transferred, or the ID is invalid."
        action={<Link href="/legal/list" className="btn primary">← Back to cases</Link>}
      />
    </div>
  );
}

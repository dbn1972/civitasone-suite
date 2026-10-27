import Link from "next/link";
import { EmptyState, PageHeader } from "@/app/_components/ds";

/**
 * GAP-DOMAINS-NEW-01: /domains index.
 *
 * domains/new/page.tsx linked back to /domains and routed here on a
 * successful registration, but no /domains index route existed, so a
 * successful registration landed on a 404.
 *
 * The backing domain-service / `GET /api/v1/domains` listing endpoint is
 * absent from this snapshot (see HUMAN REVIEW), so this page does NOT
 * fabricate a domain list. It is an honest landing page that confirms the
 * registration destination and routes on to the form; it should be replaced
 * with a real registry table once the listing endpoint exists.
 */
export default function DomainsPage() {
  return (
    <div className="page-main wrap">
      <PageHeader
        title="Domains"
        subtitle="Government domains registered for GovUX audit and WCAG compliance tracking."
      />

      <div className="card" style={{ marginTop: 18 }}>
        <EmptyState
          title="No domain registry listing yet"
          message="The registry listing is not available on this page. Domain registration uses the admin custom-domains service; registered domains and their DNS verification are managed under Tenant admin, Domain. Use the button below to register a domain."
          action={
            <Link href="/domains/new" className="btn primary">
              Register New Domain
            </Link>
          }
        />
      </div>
    </div>
  );
}

import Link from "next/link";
import { EmptyState, LoadErrorState, PageHeader } from "@/app/_components/ds";
import { getCustomDomains } from "@/app/_data/loaders";
import { formatIndianDate } from "@/lib/formatters";

const STATUS_LABEL: Record<string, string> = {
  pending_verification: "Pending verification",
  verified: "Verified",
  active: "Active",
  failed: "Failed",
  revoked: "Revoked",
};
const STATUS_TONE: Record<string, string> = {
  pending_verification: "warn",
  verified: "good",
  active: "good",
  failed: "bad",
  revoked: "mut",
};

/**
 * /domains index -- the registry listing, backed by admin-service
 * GET /v1/admin/custom-domains (via the gateway proxy, scoped to the caller's
 * tenant and gated to platform_admin / super_admin server-side). Registration
 * stays on /domains/new; DNS verification is managed under Tenant admin, Domain.
 */
export default async function DomainsPage() {
  const result = await getCustomDomains();
  const domains = result.data;

  const registerAction = (
    <Link href="/domains/new" className="btn primary">
      Register New Domain
    </Link>
  );

  return (
    <div className="page-main wrap">
      <PageHeader
        title="Domains"
        subtitle="Government domains registered for GovUX audit and WCAG compliance tracking."
        actions={registerAction}
      />

      <div className="card" style={{ marginTop: 18 }}>
        {result.source === "error" ? (
          <LoadErrorState result={result} area="domains" module="the domain registry" backHref="/dashboard" backLabel="Back to dashboard" />
        ) : domains.length === 0 ? (
          <EmptyState
            title="No domains registered yet"
            message="Register a custom domain to start DNS verification. Verification status is managed under Tenant admin, Domain."
            action={registerAction}
          />
        ) : (
          <table className="table" aria-label="Registered domains">
            <thead>
              <tr>
                <th scope="col">Domain</th>
                <th scope="col">Status</th>
                <th scope="col">Verification</th>
                <th scope="col">SSL</th>
                <th scope="col">Registered</th>
              </tr>
            </thead>
            <tbody>
              {domains.map((d) => (
                <tr key={d.id}>
                  <td>{d.domain}</td>
                  <td>
                    <span className={`pill ${STATUS_TONE[d.status] ?? "mut"}`}>{STATUS_LABEL[d.status] ?? d.status}</span>
                  </td>
                  <td>{d.verificationMethod === "dns_cname" ? "DNS CNAME" : "DNS TXT"}</td>
                  <td>{d.sslStatus}</td>
                  <td>{formatIndianDate(d.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

import { PageHeader, StatGrid, StatCard } from "@/app/_components/ds";
import { getCustomDomains } from "@/app/_data/loaders";
import { DomainClient } from "./DomainClient";

export default async function DomainPage() {
  const { data: domains, source } = await getCustomDomains();
  const activeDomains = domains.filter((d) => d.status === "active").length;
  const pendingDomains = domains.filter((d) => d.status === "pending_verification").length;

  return (
    <div className="page-main wrap">
      {/* UX-012: the data-source badge now lives inside DomainClient,
          driven by the same useSeededResource call that produces its rows —
          not a second, independent read of `source` here that could
          disagree with the client's own cache state (UX-002's pattern). */}
      <PageHeader
        title="Custom Domains"
        subtitle="Register and verify custom domains for your organisation's login and portal URLs."
        actions={<a href="/settings/branding" className="btn ghost" style={{ minHeight: 44 }}>Manage branding</a>}
      />

      <StatGrid>
        <StatCard icon="🌐" tone="neutral" label="Total Domains" value={domains.length} />
        <StatCard icon="✅" tone="good" label="Active" value={activeDomains} />
        <StatCard icon="⏳" tone="warn" label="Pending" value={pendingDomains} />
        <StatCard icon="🔒" tone="neutral" label="SSL Issued" value={domains.filter((d) => d.sslStatus === "issued").length} />
      </StatGrid>

      <DomainClient domains={domains} source={source} />
    </div>
  );
}

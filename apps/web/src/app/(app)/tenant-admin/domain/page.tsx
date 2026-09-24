import { PageHeader, StatGrid, StatCard } from "@/app/_components/ds";
import { getCustomDomains } from "@/app/_data/loaders";
import { DomainClient } from "./DomainClient";

export default async function DomainPage() {
  const { data: domains, source } = await getCustomDomains();
  const activeDomains = domains.filter((d) => d.status === "active").length;
  const pendingDomains = domains.filter((d) => d.status === "pending_verification").length;

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      {/* UX-012: the data-source badge now lives inside DomainClient,
          driven by the same useSeededResource call that produces its rows —
          not a second, independent read of `source` here that could
          disagree with the client's own cache state (UX-002's pattern). */}
      <PageHeader title="Custom Domain & White-Label" subtitle="Configure custom domains and branding for your organization." back="/tenant-admin" />

      <StatGrid>
        <StatCard icon="🌐" iconBg="#eef2ff" label="Total Domains" value={domains.length} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Active" value={activeDomains} />
        <StatCard icon="⏳" iconBg="#fef3c7" label="Pending" value={pendingDomains} />
        <StatCard icon="🔒" iconBg="#dbeafe" label="SSL Issued" value={domains.filter((d) => d.sslStatus === "issued").length} />
      </StatGrid>

      <DomainClient domains={domains} source={source} />
    </div>
  );
}

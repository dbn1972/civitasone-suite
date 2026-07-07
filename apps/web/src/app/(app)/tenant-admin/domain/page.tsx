import { PageHeader, StatGrid, StatCard } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { getCustomDomains } from "@/app/_data/loaders";
import { DomainClient } from "./DomainClient";

export default async function DomainPage() {
  const { data: domains, source } = await getCustomDomains();
  const activeDomains = domains.filter((d) => d.status === "active").length;
  const pendingDomains = domains.filter((d) => d.status === "pending_verification").length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Custom Domain & White-Label" subtitle="Configure custom domains and branding for your organization." back="/tenant-admin" />
      <DataSourceBadge source={source} />

      <StatGrid>
        <StatCard icon="🌐" iconBg="#eef2ff" label="Total Domains" value={domains.length} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Active" value={activeDomains} />
        <StatCard icon="⏳" iconBg="#fef3c7" label="Pending" value={pendingDomains} />
        <StatCard icon="🔒" iconBg="#dbeafe" label="SSL Issued" value={domains.filter((d) => d.sslStatus === "issued").length} />
      </StatGrid>

      <DomainClient domains={domains} source={source} />
    </main>
  );
}

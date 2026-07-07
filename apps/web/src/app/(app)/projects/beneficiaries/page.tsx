import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card, EmptyState } from "@/app/_components/ds";
import { getProjectBeneficiaries } from "@/app/_data/loaders";
import { BeneficiariesTable } from "./BeneficiariesTable";

export default async function BeneficiariesPage() {
  const { data: rows, source } = await getProjectBeneficiaries();

  const total = rows.length;
  const active = rows.filter((r) => r.verified === "active").length;
  const pending = rows.filter((r) => r.verified === "pending").length;
  const notVerified = rows.filter((r) => r.verified === "rejected").length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Beneficiaries" subtitle="Track project beneficiaries, verification status and disbursements." back="/projects" />
      {source === "error" && <DataSourceBadge source="error" />}
      <StatGrid>
        <StatCard icon="👥" iconBg="#eff6ff" label="Total Beneficiaries" value={total} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Active" value={active} />
        <StatCard icon="🔍" iconBg="#fffaeb" label="Verified" value={active} />
        <StatCard icon="⏳" iconBg="#fef3f2" label="Pending Verification" value={pending + notVerified} />
      </StatGrid>
      <Card title="Beneficiary Register">
        {rows.length === 0 ? (
          <EmptyState icon="👥" title="No beneficiaries" message="No project beneficiaries have been registered yet." action={<a href="/projects/list" className="btn primary">View Projects</a>} />
        ) : (
          <BeneficiariesTable rows={rows} source={source === "error" ? "error" : "api"} />
        )}
      </Card>
    </main>
  );
}

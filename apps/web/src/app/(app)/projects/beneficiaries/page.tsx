import { PageHeader, StatGrid, StatCard, Card, EmptyState, RefreshErrorState } from "@/app/_components/ds";
import { getProjectBeneficiaries } from "@/app/_data/loaders";
import { BeneficiariesTable } from "./BeneficiariesTable";
import { toResourceState } from "@/app/_data/useResource";
import { toHumanError } from "@/lib/messages";

export default async function BeneficiariesPage() {
  const result = await getProjectBeneficiaries();
  const { data: rows, source } = result;
  const resource = toResourceState(result);
  const errored = resource.status === "error";

  const total = errored ? null : rows.length;
  // GAP-PROJECTS-BENEFICIARIES-02: "Active" and "Verified" previously showed the
  // SAME count (both verified==='active') and "Pending Verification" counted
  // pending + rejected, so rejected applicants looked pending. Now: Verified =
  // active, Pending = pending ONLY, Rejected = rejected — four distinct figures.
  const verified = errored ? null : rows.filter((r) => r.verified === "active").length;
  const pending = errored ? null : rows.filter((r) => r.verified === "pending").length;
  const rejected = errored ? null : rows.filter((r) => r.verified === "rejected").length;

  return (
    <div className="page-main wrap">
      <PageHeader title="Beneficiaries" subtitle="Track project beneficiaries, verification status and disbursements." back="/projects" />
      <StatGrid>
        <StatCard icon="👥" iconBg="#eff6ff" label="Total Beneficiaries" value={total ?? "—"} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Verified" value={verified ?? "—"} />
        <StatCard icon="⏳" iconBg="#fffaeb" label="Pending Verification" value={pending ?? "—"} />
        <StatCard icon="🚫" iconBg="#fef3f2" label="Rejected" value={rejected ?? "—"} />
      </StatGrid>
      <Card title="Beneficiary Register">
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "beneficiaries" })} backHref="/projects" />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState icon="👥" title="No beneficiaries" message="No project beneficiaries have been registered yet." action={<a href="/projects/list" className="btn primary">View Projects</a>} />
        ) : (
          <BeneficiariesTable rows={rows} source={source === "error" ? "error" : "api"} />
        )}
      </Card>
    </div>
  );
}

import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { getGrantees } from "../../../_data/loaders";
import { GranteesTable } from "./GranteesTable";
import { ArrowLeft } from "lucide-react";

export default async function GranteesPage() {
  const { data: grantees, source } = await getGrantees();

  // "NGO/Trust/Society" grantees are recorded as type "society" or "mission"
  // (grant_beneficiaries_type_check allows individual/institution/society/mission — see DOM-022).
  const ngos = grantees.filter((g) => g.type === "society" || g.type === "mission").length;
  const totalActiveGrants = grantees.reduce((s, g) => s + g.activeGrants, 0);
  const avgCompliance =
    grantees.length > 0
      ? grantees.reduce((s, g) => s + g.ucCompliancePct, 0) / grantees.length
      : 0;

  return (
    <>
      <nav aria-label="Breadcrumb" className="back">
        <ArrowLeft aria-hidden="true" size={14} /> <a href="/grants">Grants</a>
      </nav>
      <PageHeader title="Grantees" subtitle="Registered grantee organisations and compliance status." />
      {/* UX-012: the data-source badge now lives inside GranteesTable, driven
          by the same useSeededResource call that produces its rows — not a
          second, independent read of `source` here that could disagree with
          the table's own cache state (UX-002's pattern). */}
      <div aria-label="Grantees">
        <StatGrid>
          <StatCard icon="👤" iconBg="#f1f5f9" label="Total" value={grantees.length} />
          <StatCard icon="🏢" iconBg="#faf5ff" label="NGOs" value={ngos} />
          <StatCard icon="🎁" iconBg="#dcfce7" label="Active Grants" value={totalActiveGrants} />
          <StatCard icon="📋" iconBg="#fef3c7" label="UC Compliance" value={`${avgCompliance.toFixed(1)}%`} />
        </StatGrid>
        <Card title="Grantees">
          <GranteesTable grantees={grantees} source={source} />
        </Card>
      </div>
    </>
  );
}

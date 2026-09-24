import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { getGrantUtilization } from "../../../_data/loaders";
import { UtilizationTable } from "./UtilizationTable";
import { ArrowLeft } from "lucide-react";

export default async function GrantUtilizationPage() {
  const { data: ucs, source } = await getGrantUtilization();

  const verified = ucs.filter((u) => u.status === "verified").length;
  const submitted = ucs.filter((u) => u.status === "submitted").length;
  const pending = ucs.filter((u) => u.status === "pending").length;

  return (
    <>
      <nav aria-label="Breadcrumb" className="back">
        <ArrowLeft aria-hidden="true" size={14} /> <a href="/grants">Grants</a>
      </nav>
      <PageHeader
        title="Utilization Certificates"
        subtitle="UC submission and verification tracking."
      />
      {/* UX-012: the data-source badge now lives inside UtilizationTable,
          driven by the same useSeededResource call that produces its rows —
          not a second, independent read of `source` here that could
          disagree with the table's own cache state (UX-002's pattern). */}
      <div aria-label="Utilization certificates">
        <StatGrid>
          <StatCard icon="📋" iconBg="#f1f5f9" label="Total" value={ucs.length} />
          <StatCard icon="✅" iconBg="#dcfce7" label="Verified" value={verified} />
          <StatCard icon="📄" iconBg="#dbeafe" label="Submitted" value={submitted} />
          <StatCard icon="⏳" iconBg="#fef3c7" label="Pending" value={pending} />
        </StatGrid>
        <Card title="Utilization Certificates">
          <UtilizationTable ucs={ucs} source={source} />
        </Card>
      </div>
    </>
  );
}

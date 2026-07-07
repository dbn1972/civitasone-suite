import { PageHeader, StatGrid, StatCard, Card, EmptyState } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { getVigilanceCases } from "@/app/_data/loaders";
import { VigilanceTable } from "./VigilanceTable";

export default async function VigilancePage() {
  const { data: cases, source } = await getVigilanceCases();

  const totalCases = cases.length;
  const underInvestigation = cases.filter((c) => c.inquiryStatus === "under_investigation" || c.inquiryStatus === "preliminary_enquiry").length;
  const inquiryComplete = cases.filter((c) => c.inquiryStatus === "inquiry_complete").length;
  const penaltiesImposed = cases.filter((c) => c.outcome === "major_penalty" || c.outcome === "minor_penalty").length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Vigilance Cases"
        subtitle="Departmental vigilance proceedings and inquiry outcomes."
        back="/audit"
      />
      <DataSourceBadge source={source} />

      <StatGrid>
        <StatCard icon="🔍" iconBg="#eef2ff" label="Total Cases" value={totalCases} />
        <StatCard icon="⏳" iconBg="#ecfdf3" label="Under Investigation" value={underInvestigation} />
        <StatCard icon="📋" iconBg="#fffaeb" label="Inquiry Complete" value={inquiryComplete} />
        <StatCard icon="⚠️" iconBg="#fce7ee" label="Penalties Imposed" value={penaltiesImposed} />
      </StatGrid>

      {cases.length === 0 ? (
        <Card title="Vigilance Register">
          <EmptyState
            icon="🔍"
            title="No vigilance cases found"
            message="Departmental vigilance cases will appear here once registered."
          />
        </Card>
      ) : (
        <Card title="Vigilance Register">
          <VigilanceTable rows={cases} source={source} />
        </Card>
      )}
    </main>
  );
}

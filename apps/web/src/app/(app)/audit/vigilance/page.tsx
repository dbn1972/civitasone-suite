import { PageHeader, StatGrid, StatCard, Card, EmptyState, RefreshErrorState } from "@/app/_components/ds";
import { getVigilanceCases } from "@/app/_data/loaders";
import { useResource } from "@/app/_data/useResource";
import { toHumanError } from "@/lib/messages";
import { VigilanceTable } from "./VigilanceTable";

export default async function VigilancePage() {
  const result = await getVigilanceCases();
  const { data: cases, source } = result;
  const resource = useResource(result);
  const errored = resource.status === "error";

  const totalCases = errored ? null : cases.length;
  const underInvestigation = errored
    ? null
    : cases.filter((c) => c.inquiryStatus === "under_investigation" || c.inquiryStatus === "preliminary_enquiry").length;
  const inquiryComplete = errored ? null : cases.filter((c) => c.inquiryStatus === "inquiry_complete").length;
  const penaltiesImposed = errored
    ? null
    : cases.filter((c) => c.outcome === "major_penalty" || c.outcome === "minor_penalty").length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Vigilance Cases"
        subtitle="Departmental vigilance proceedings and inquiry outcomes."
        back="/audit"
      />

      <StatGrid>
        <StatCard icon="🔍" iconBg="#eef2ff" label="Total Cases" value={totalCases ?? "—"} />
        <StatCard icon="⏳" iconBg="var(--goodbg)" label="Under Investigation" value={underInvestigation ?? "—"} />
        <StatCard icon="📋" iconBg="var(--warnbg)" label="Inquiry Complete" value={inquiryComplete ?? "—"} />
        <StatCard icon="⚠️" iconBg="#fce7ee" label="Penalties Imposed" value={penaltiesImposed ?? "—"} />
      </StatGrid>

      {errored ? (
        <Card title="Vigilance Register">
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "vigilance cases" })} backHref="/audit" />
          </div>
        </Card>
      ) : cases.length === 0 ? (
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

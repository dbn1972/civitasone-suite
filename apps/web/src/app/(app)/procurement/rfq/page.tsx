import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card, EmptyState, ErrorState } from "../../../_components/ds";
import { getRFQs } from "../../../_data/loaders";
import { toHumanError } from "@/lib/messages";
import { RFQTable } from "./RFQTable";

export default async function RFQPage() {
  const { data: rfqs, source } = await getRFQs();

  const issued = rfqs.filter((r) => r.status === "issued").length;
  // GAP-PROCUREMENT-RFQ-04: this tile sums `responsesReceived` across RFQs,
  // i.e. the number of QUOTES received, not distinct vendors — the backend
  // RFQSummary carries no vendor-id set to de-duplicate on. Labelled honestly
  // as "Quotes received" so the figure is not misread as "unique vendors".
  const totalQuotes = rfqs.reduce((sum, r) => sum + r.responsesReceived, 0);
  const awarded = rfqs.filter((r) => r.status === "awarded").length;

  return (
    <>
      <PageHeader
        title="Request for Quotation"
        subtitle="Manage RFQs issued to vendors and track responses received."
        actions={
          <>
            {/* GAP-PROCUREMENT-RFQ-01: the former "Templates" link went to
                /procurement/rfq/new?template=1, but the create form never read
                that query string — it opened the same blank form, and no RFQ
                template model/endpoint exists. Removed rather than shipping a
                dead control (decision recorded in batch report). */}
            <Link href="/procurement/rfq/new" className="btn primary">+ New RFQ</Link>
            {source === "error" ? <DataSourceBadge source={source} message="Couldn't load — showing nothing" /> : null}
          </>
        }
      />

      <StatGrid>
        <StatCard icon="📝" iconBg="#e7edfd" label="Total RFQs" value={rfqs.length} />
        <StatCard icon="📤" iconBg="#eff6ff" label="Issued" value={issued} />
        <StatCard icon="📥" iconBg="#ecfdf3" label="Quotes received" value={totalQuotes} />
        <StatCard icon="🏆" iconBg="#fffaeb" label="Awarded" value={awarded} />
      </StatGrid>

      {source === "error" ? (
        // L4 fix: see tenders/page.tsx for the same fix and rationale.
        <Card title="Requests for quotation">
          <ErrorState error={toHumanError("load", { area: "RFQs" })} backHref="/procurement/rfq" />
        </Card>
      ) : rfqs.length === 0 ? (
        <Card title="Requests for quotation">
          <EmptyState
            icon="📝"
            title="No RFQs found"
            message="Create a new RFQ to start collecting vendor quotes."
            action={<Link href="/procurement/rfq/new" className="btn primary">+ New RFQ</Link>}
          />
        </Card>
      ) : (
        <RFQTable rfqs={rfqs} />
      )}
    </>
  );
}

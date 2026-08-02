import Link from "next/link";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, EmptyState, Card } from "@/app/_components/ds";
import { getCase, getCaseCertifiedCopies, getCaseHearings, getCaseOrders } from "../../_data/loaders";
import { CaseConsole } from "./CaseConsole";

export const dynamic = "force-dynamic";

export default async function CaseDetailPage({
  params,
}: {
  params: { caseId: string };
}) {
  const { caseId } = params;
  const [detail, orders, hearings, certifiedCopies] = await Promise.all([
    getCase(caseId),
    getCaseOrders(caseId),
    getCaseHearings(caseId),
    getCaseCertifiedCopies(caseId),
  ]);

  if (detail.source === "error" || !detail.data) {
    return (
      <>
        <PageHeader
          title="Case"
          subtitle="Parties, lifecycle, hearings and orders for a matter."
          back="/court/cases"
          backLabel="Cases"
        />
        <DataSourceBadge source="error" />
        <Card padding>
          <EmptyState
            icon="🗂️"
            title="Case not available"
            message="This case couldn't be loaded. It may belong to another court, or live data couldn't be reached. Go back and pick another case."
          />
          <div style={{ marginTop: 12 }}>
            <Link className="btn ghost sm" href="/court/cases">
              ← Back to cases
            </Link>
          </div>
        </Card>
      </>
    );
  }

  const degraded = orders.source === "error" || hearings.source === "error" || certifiedCopies.source === "error";

  return (
    <>
      <PageHeader
        title={detail.data.title || "Case"}
        subtitle="Drive the case lifecycle, schedule and adjourn hearings, draft & issue orders through the maker-checker flow, and manage certified-copy applications."
        back="/court/cases"
        backLabel="Cases"
      />
      {degraded && <DataSourceBadge source="error" />}
      <CaseConsole
        caseDetail={detail.data}
        initialOrders={orders.data}
        ordersSource={orders.source}
        initialHearings={hearings.data}
        hearingsSource={hearings.source}
        initialCertifiedCopies={certifiedCopies.data}
        certifiedCopiesSource={certifiedCopies.source}
      />
    </>
  );
}

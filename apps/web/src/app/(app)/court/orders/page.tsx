import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { Card, EmptyState, PageHeader } from "@/app/_components/ds";
import { getSessionUserId } from "@/lib/auth/roleGuard";
import { getCase, getCaseHearings, getCaseOrders, getCases } from "../_data/loaders";
import { CaseSelector } from "../_components/CaseSelector";
import { OrdersConsole } from "./OrdersConsole";

export const dynamic = "force-dynamic";

export default async function OrdersListPage({
  searchParams,
}: {
  searchParams: { caseId?: string };
}) {
  const caseId = (searchParams.caseId ?? "").trim();
  const casesResult = await getCases();
  // GAP-COURT-ORDERS-01: the signed-in officer's id (JWT sub) lets the console
  // disable "Approve & issue" on an order the viewer drafted themselves — a
  // maker-checker UX hint. The court-service remains the authority: its
  // order-issuance consumer rejects a self-approval (approver ≠ maker) before
  // any write regardless of what the UI offers.
  const currentUserId = getSessionUserId();

  // GAP-COURT-ORDERS-05: hearings for the selected case, so the draft form can
  // offer an optional "Linked hearing" and rows can show the linked date.
  const [detailResult, ordersResult, hearingsResult] = caseId
    ? await Promise.all([getCase(caseId), getCaseOrders(caseId), getCaseHearings(caseId)])
    : [null, null, null];

  return (
    <>
      <PageHeader
        title="Orders"
        subtitle="Orders belong to a case — pick one below to draft, submit, approve & issue, send back, or recall its orders."
        back="/court"
        backLabel="Court"
      />

      <Card title="Select a case" padding>
        <CaseSelector
          cases={casesResult.data}
          casesSource={casesResult.source}
          basePath="/court/orders"
          selectedCaseId={caseId}
        />
      </Card>

      {!caseId ? (
        <Card padding>
          <EmptyState
            icon="📜"
            title="No case selected"
            message="Pick a case above to see and manage its orders."
          />
        </Card>
      ) : !detailResult || detailResult.source === "error" || !detailResult.data ? (
        <Card padding>
          <DataSourceBadge source="error" />
          <EmptyState
            icon="📜"
            title="Case not available"
            message="This case couldn't be loaded. It may belong to another court, or live data couldn't be reached. Pick another case above."
          />
        </Card>
      ) : (
        <OrdersConsole
          caseId={detailResult.data.id}
          caseSummary={{ title: detailResult.data.title, cnrNumber: detailResult.data.cnrNumber }}
          initialOrders={ordersResult ? ordersResult.data : []}
          ordersSource={ordersResult ? ordersResult.source : "error"}
          currentUserId={currentUserId}
          hearings={hearingsResult ? hearingsResult.data : []}
        />
      )}
    </>
  );
}

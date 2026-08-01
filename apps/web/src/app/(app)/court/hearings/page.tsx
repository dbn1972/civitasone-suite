import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { Card, EmptyState, PageHeader } from "@/app/_components/ds";
import { getCase, getCaseHearings, getCases } from "../_data/loaders";
import { CaseSelector } from "../_components/CaseSelector";
import { HearingsConsole } from "./HearingsConsole";

export const dynamic = "force-dynamic";

export default async function HearingsListPage({
  searchParams,
}: {
  searchParams: { caseId?: string };
}) {
  const caseId = (searchParams.caseId ?? "").trim();
  const casesResult = await getCases();

  const [detailResult, hearingsResult] = caseId
    ? await Promise.all([getCase(caseId), getCaseHearings(caseId)])
    : [null, null];

  return (
    <>
      <PageHeader
        title="Hearings"
        subtitle="Hearings belong to a case — pick one below to schedule, adjourn, or record the outcome of its hearings."
        back="/court"
        backLabel="Court"
      />
      {casesResult.source === "error" && <DataSourceBadge source="error" />}

      <Card title="Select a case" padding>
        <CaseSelector cases={casesResult.data} basePath="/court/hearings" selectedCaseId={caseId} />
      </Card>

      {!caseId ? (
        <Card padding>
          <EmptyState
            icon="📅"
            title="No case selected"
            message="Pick a case above to see and manage its hearings."
          />
        </Card>
      ) : !detailResult || detailResult.source === "error" || !detailResult.data ? (
        <Card padding>
          <DataSourceBadge source="error" />
          <EmptyState
            icon="📅"
            title="Case not available"
            message="This case couldn't be loaded. It may belong to another court, or live data couldn't be reached. Pick another case above."
          />
        </Card>
      ) : (
        <HearingsConsole
          caseId={detailResult.data.id}
          caseSummary={{ title: detailResult.data.title, cnrNumber: detailResult.data.cnrNumber }}
          initialHearings={hearingsResult ? hearingsResult.data : []}
          hearingsSource={hearingsResult ? hearingsResult.source : "error"}
        />
      )}
    </>
  );
}

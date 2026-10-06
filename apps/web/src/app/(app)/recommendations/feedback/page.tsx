import { PageHeader } from "../../../_components/ds";
import { RefreshErrorState } from "../../../_components/ds/RefreshErrorState";
import { toHumanError } from "@/lib/messages";
import { getRecFeedback } from "../_data";
import { FeedbackSummaryView } from "./FeedbackSummaryView";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getRecFeedback();
  return (
    <div className="page-main" aria-labelledby="page-heading">
      <PageHeader
        title="Recommendations — Rejection feedback"
        subtitle="Why recommendations were rejected, grouped by reason."
        back="/recommendations"
        backLabel="Recommendations"
      />
      {source === "error" ? (
        <RefreshErrorState
          error={toHumanError("load", { area: "feedback" })}
          source={{ area: "feedback" }}
          backHref="/recommendations"
        />
      ) : (
        <FeedbackSummaryView summary={data} />
      )}
    </div>
  );
}

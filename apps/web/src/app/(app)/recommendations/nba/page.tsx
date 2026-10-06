import { PageHeader } from "../../../_components/ds";
import { RefreshErrorState } from "../../../_components/ds/RefreshErrorState";
import { toHumanError } from "@/lib/messages";
import { getRecNba } from "../_data";
import { NbaTable } from "./NbaTable";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getRecNba();
  return (
    <div className="page-main" aria-labelledby="page-heading">
      <PageHeader
        title="Recommendations — Next Best Action"
        subtitle="Predictive model scores for your customers and records, highest score first."
        back="/recommendations"
        backLabel="Recommendations"
      />
      {source === "error" ? (
        <RefreshErrorState
          error={toHumanError("load", { area: "predictive scores" })}
          source={{ area: "predictive scores" }}
          backHref="/recommendations"
        />
      ) : (
        <NbaTable rows={data} />
      )}
    </div>
  );
}

import { PageHeader } from "../../../_components/ds";
import { RefreshErrorState } from "../../../_components/ds/RefreshErrorState";
import { toHumanError } from "@/lib/messages";
import { getRecHealth } from "../_data";
import { HealthTable } from "./HealthTable";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getRecHealth();
  return (
    <div className="page-main" aria-labelledby="page-heading">
      <PageHeader
        title="Recommendations — At-risk accounts"
        subtitle="Accounts in the critical and at-risk health bands, highest risk first."
        back="/recommendations"
        backLabel="Recommendations"
      />
      {source === "error" ? (
        <RefreshErrorState
          error={toHumanError("load", { area: "at-risk accounts" })}
          source={{ area: "at-risk accounts" }}
          backHref="/recommendations"
        />
      ) : (
        <HealthTable rows={data} />
      )}
    </div>
  );
}

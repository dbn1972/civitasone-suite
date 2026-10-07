import { PageHeader } from "../../../_components/ds";
import { RefreshErrorState } from "../../../_components/ds/RefreshErrorState";
import { toHumanError } from "@/lib/messages";
import { getRecMatrix } from "../_data";
import { MatrixTable } from "./MatrixTable";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getRecMatrix();
  return (
    <div className="page-main">
      <PageHeader
        title="Recommendations — Cross-Sell Matrix"
        subtitle="Product affinity rules (read-only)."
        back="/recommendations"
        backLabel="Recommendations"
      />
      {source === "error" ? (
        <RefreshErrorState
          error={toHumanError("load", { area: "cross-sell rules" })}
          source={{ area: "cross-sell rules" }}
          backHref="/recommendations"
        />
      ) : (
        <MatrixTable rows={data} />
      )}
    </div>
  );
}

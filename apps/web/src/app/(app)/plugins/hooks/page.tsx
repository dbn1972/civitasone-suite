import { PageHeader, RefreshErrorState } from "../../../_components/ds";
import { getPluginHooksTyped } from "../_data";
import { HooksTable } from "../HooksTable";
import { toHumanError } from "@/lib/messages";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getPluginHooksTyped();
  return (
    <div className="page-main">
      <PageHeader
        title="Plugins — Hooks"
        subtitle="Business events that installed plugins subscribe to."
        back="/plugins"
        backLabel="Plugins"
      />
      <div className="card" style={{ marginTop: 18 }}>
        {source === "error" ? (
          <RefreshErrorState error={toHumanError("load", { area: "hooks" })} />
        ) : (
          <HooksTable rows={data} />
        )}
      </div>
    </div>
  );
}

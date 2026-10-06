import { PageHeader, RefreshErrorState } from "../../../_components/ds";
import { getPluginMarketplaceCatalog } from "../_data";
import { MarketplaceTable } from "../MarketplaceTable";
import { toHumanError } from "@/lib/messages";
import { getSessionRoles, hasAnyRole, PLUGIN_MANAGE_ROLES } from "@/lib/auth/roleGuard";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getPluginMarketplaceCatalog();
  const canManage = hasAnyRole(getSessionRoles(), PLUGIN_MANAGE_ROLES);
  return (
    <div className="page-main" aria-labelledby="page-heading">
      <PageHeader
        title="Plugins — Marketplace"
        subtitle="Browse plugins available to install for your organisation."
        back="/plugins"
        backLabel="Plugins"
      />
      <div className="card" style={{ marginTop: 18 }}>
        {source === "error" ? (
          <RefreshErrorState error={toHumanError("load", { area: "marketplace plugins" })} />
        ) : (
          <MarketplaceTable rows={data} canManage={canManage} />
        )}
      </div>
    </div>
  );
}

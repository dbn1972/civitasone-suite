import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, EmptyState, RefreshErrorState } from "../../../_components/ds";
import { getTranslations } from "next-intl/server";
import { getPluginRegistryCatalog } from "../_data";
import { toHumanError } from "@/lib/messages";
import { PluginsTable } from "../PluginsTable";
import { lifecycleOf } from "../pluginLifecycle";
import { getSessionRoles, hasAnyRole, PLUGIN_MANAGE_ROLES } from "@/lib/auth/roleGuard";

const INSTALLED_STATES: ReadonlySet<string> = new Set(["installed", "enabled", "active", "disabled"]);

type PluginRow = {
	id?: string;
	name: string;
	status: string;
} & Record<string, unknown>;

export default async function Page() {
	// GAP: Installed must list the SAME resource its Enable/Disable act on. Those verbs target
	// registry rows (/v1/plugins/:id/enable|disable), and marketplace install creates registry
	// rows, so read the registry (GET /v1/plugins), not the unrelated /v1/plugins/items.
	const { data, source } = await getPluginRegistryCatalog();
	const t = await getTranslations("pluginInstalled");
	// "Installed" = provisioned and not removed: drop never-installed (uploaded) and uninstalled rows.
	const plugins = data
		.filter((p) => INSTALLED_STATES.has((p.status ?? "").trim().toLowerCase()))
		.map((p): PluginRow => ({ ...p, status: p.status ?? "" }));
	const canManage = hasAnyRole(getSessionRoles(), PLUGIN_MANAGE_ROLES);

	const errored = source === "error";
	const total = errored ? null : plugins.length;
	// GAP-PLUGINS-INSTALLED-04: count by real lifecycle, not "everything that
	// isn't enabled". "Other" captures pending/error/unknown so a problem row is
	// not silently bucketed as Disabled.
	const enabled = errored ? null : plugins.filter((p) => lifecycleOf(p.status) === "enabled").length;
	const disabled = errored ? null : plugins.filter((p) => lifecycleOf(p.status) === "disabled").length;
	const other =
		errored || total === null || enabled === null || disabled === null ? null : total - enabled - disabled;

	return (
		<div className="wrap">
			<PageHeader
				title="Plugins — Installed"
				subtitle="Enable or disable tenant features through controlled plugin toggles."
				back="/plugins"
				backLabel="Plugins"
			/>

			<StatGrid>
				<StatCard icon="🧩" tone="info" label="Total Plugins" value={total === null ? "—" : total} />
				<StatCard icon="✅" tone="good" label="Enabled" value={enabled === null ? "—" : enabled} />
				<StatCard icon="⏸️" tone="neutral" label="Disabled" value={disabled === null ? "—" : disabled} />
				<StatCard icon="⚠️" tone="warn" label="Other" value={other === null ? "—" : other} />
			</StatGrid>

			{source === "error" && (
				<div style={{ margin: "12px 0" }}>
					<DataSourceBadge source={source} />
				</div>
			)}

			<div className="card" style={{ marginTop: 18 }}>
				<div className="card-h">
					<h3>Installed plugins</h3>
				</div>
				{errored ? (
					<RefreshErrorState error={toHumanError("load", { area: "plugins" })} />
				) : plugins.length === 0 ? (
					<EmptyState
						icon="🧩"
						title="No plugins available"
						message="Tenant plugins will appear here once they are provisioned for your organisation."
					/>
				) : (
					<PluginsTable rows={plugins} canManage={canManage} labels={{ disableReasonLabel: t("disableReasonLabel") }} />
				)}
			</div>
		</div>
	);
}

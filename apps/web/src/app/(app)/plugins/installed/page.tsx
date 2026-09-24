import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, EmptyState, RefreshErrorState } from "../../../_components/ds";
import { getPlugins } from "../../../_data/loaders";
import { toHumanError } from "@/lib/messages";
import { PluginsTable } from "../PluginsTable";
import { ArrowLeft } from "lucide-react";

type PluginRow = {
	id?: string;
	name: string;
	status: string;
} & Record<string, unknown>;

function isEnabled(status: string) {
	return status.toLowerCase() === "enabled";
}

export default async function Page() {
	const { data, source } = await getPlugins();
	const plugins = data as PluginRow[];

	const errored = source === "error";
	const total = errored ? null : plugins.length;
	const enabled = errored ? null : plugins.filter((p) => isEnabled(p.status)).length;
	const disabled = errored || total === null || enabled === null ? null : total - enabled;

	return (
		<div className="wrap">
			<nav aria-label="Breadcrumb" className="back">
				<ArrowLeft aria-hidden="true" size={14} /> <a href="/plugins">Plugins</a>
			</nav>
			<PageHeader
				title="Plugins — Installed"
				subtitle="Enable or disable tenant features through controlled plugin toggles."
			/>

			<StatGrid>
				<StatCard icon="🧩" iconBg="#eff8ff" label="Total Plugins" value={total === null ? "—" : total} />
				<StatCard icon="✅" iconBg="#e6f7f0" label="Enabled" value={enabled === null ? "—" : enabled} />
				<StatCard icon="⏸️" iconBg="#f4f5f7" label="Disabled" value={disabled === null ? "—" : disabled} />
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
					<PluginsTable rows={plugins} />
				)}
			</div>
		</div>
	);
}

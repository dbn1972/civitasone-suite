import { DataSourceBadge } from "../../_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, DataTable, EmptyState } from "../../_components/ds";
import { getPlugins } from "../../_data/loaders";
import { PluginActions } from "./PluginActions";

type PluginRow = {
	id?: string;
	name: string;
	status: string;
} & Record<string, unknown>;

function isEnabled(status: string) {
	return status.toLowerCase() === "enabled";
}

/** Status pill with text label — never colour-only (the .pill dot is decorative). */
function StatusCell({ status }: { status: string }) {
	const enabled = isEnabled(status);
	return <span className={`pill ${enabled ? "good" : "mut"}`}>{enabled ? "Enabled" : "Disabled"}</span>;
}

export default async function Page() {
	const { data, source } = await getPlugins();
	const plugins = data as PluginRow[];

	const total = plugins.length;
	const enabled = plugins.filter((p) => isEnabled(p.status)).length;
	const disabled = total - enabled;

	return (
		<main className="wrap">
			<PageHeader
				title="Plugins"
				subtitle="Enable or disable tenant features through controlled plugin toggles."
			/>

			<StatGrid>
				<StatCard icon="🧩" iconBg="#eff8ff" label="Total Plugins" value={total} />
				<StatCard icon="✅" iconBg="#e6f7f0" label="Enabled" value={enabled} />
				<StatCard icon="⏸️" iconBg="#f4f5f7" label="Disabled" value={disabled} />
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
				{plugins.length === 0 ? (
					<EmptyState
						icon="🧩"
						title="No plugins available"
						message="Tenant plugins will appear here once they are provisioned for your organisation."
					/>
				) : (
					<DataTable<PluginRow>
						sortable
						filterable
						filterPlaceholder="Filter plugins…"
						columns={[
							{ key: "name", label: "Plugin" },
							{
								key: "status",
								label: "Status",
								render: (row) => <StatusCell status={row.status} />,
							},
							{
								key: "id",
								label: "Actions",
								sortable: false,
								align: "right",
								render: (row) => <PluginActions plugin={row} />,
							},
						]}
						rows={plugins}
					/>
				)}
			</div>
		</main>
	);
}

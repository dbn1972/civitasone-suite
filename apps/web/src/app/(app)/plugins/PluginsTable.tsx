"use client";

import { DataTable } from "../../_components/ds";
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

export function PluginsTable({ rows }: { rows: PluginRow[] }) {
	return (
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
			rows={rows}
		/>
	);
}

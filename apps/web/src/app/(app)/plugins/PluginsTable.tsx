"use client";

import { DataTable, StatusPill } from "../../_components/ds";
import { PluginActions } from "./PluginActions";

type PluginRow = {
	id?: string;
	name: string;
	status: string;
} & Record<string, unknown>;

/**
 * GAP-PLUGINS-INSTALLED-04 (theme STATUS): the status cell used to collapse
 * every non-"enabled" value (pending, error, suspended) to a grey "Disabled"
 * pill. It now renders the real status through StatusPill, which humanises the
 * label and keeps unknown statuses as-is with an honest tone, so an errored
 * plugin reads "Error", not "Disabled".
 */
export function PluginsTable({ rows, canManage = true }: { rows: PluginRow[]; canManage?: boolean }) {
	return (
		<DataTable<PluginRow>
			sortable
			filterable
			filterPlaceholder="Filter plugins…"
			filterKeys={["name", "status"]}
			pageSize={15}
			rowKey={(row) => row.id ?? row.name}
			columns={[
				{ key: "name", label: "Plugin" },
				{
					key: "status",
					label: "Status",
					render: (row) => <StatusPill status={row.status} />,
				},
				{
					key: "id",
					label: "Actions",
					sortable: false,
					align: "right",
					render: (row) => <PluginActions plugin={row} canManage={canManage} />,
				},
			]}
			rows={rows}
		/>
	);
}

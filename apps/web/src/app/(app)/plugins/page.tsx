import { PageShell } from "../../_components/PageShell";
import { DataSourceBadge } from "../../_components/DataSourceBadge";
import { getPlugins } from "../../_data/loaders";

export default async function Page() {
	const { data: plugins, source } = await getPlugins();

	return (
		<PageShell title="Plugins" description="Enable or disable tenant features through controlled plugin toggles.">
				{source === "error" ? <DataSourceBadge source={source} /> : null}
				<div className="space-y-3">
					{plugins.map((plugin) => (
						<article key={plugin.name} className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
							<span className="font-medium text-slate-900">{plugin.name}</span>
							<span className={`rounded-full px-2 py-1 text-xs font-medium ${plugin.status === "enabled" ? "bg-emerald-50 text-emerald-700" : "bg-slate-200 text-slate-700"}`}>
								{plugin.status}
							</span>
						</article>
					))}
				</div>
		</PageShell>
	);
}

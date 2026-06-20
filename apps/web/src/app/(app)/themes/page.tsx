import { PageShell } from "../../_components/PageShell";
import { DataSourceBadge } from "../../_components/DataSourceBadge";
import { getThemeTokens } from "../../_data/loaders";

export default async function Page() {
	const { data: themeTokens, source } = await getThemeTokens();

	return (
		<PageShell title="Themes" description="Tenant branding and token preview workspace.">
				{source === "error" ? <DataSourceBadge source={source} /> : null}

				<div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
					<div className="grid gap-2 text-sm text-slate-700">
						{themeTokens.map((token) => (
							<div key={token.key} className="flex items-center justify-between border-b border-slate-100 py-2 last:border-b-0">
								<span className="font-mono text-xs text-slate-600">{token.key}</span>
								<span>{token.value}</span>
							</div>
						))}
					</div>
				</div>
		</PageShell>
	);
}

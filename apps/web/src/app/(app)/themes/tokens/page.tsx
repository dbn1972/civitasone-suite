import { PageShell } from "../../../_components/PageShell";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { Card, StatGrid, StatCard } from "@/app/_components/ds";
import { getThemeTokens } from "../../../_data/loaders";
import { ThemeActions } from "../ThemeActions";
import { ThemeTokenTable } from "../ThemeTokenTable";

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export default async function Page() {
	const { data: themeTokens, source } = await getThemeTokens();

	const total = themeTokens.length;
	const colourTokens = themeTokens.filter((t) => HEX.test(String(t.value ?? "").trim())).length;
	const scalarTokens = total - colourTokens;

	return (
		<PageShell title="Themes — Tokens" description="Tenant branding and token preview workspace.">
			<nav aria-label="Breadcrumb" className="back">
				← <a href="/themes">Themes</a>
			</nav>
			{source === "error" ? <DataSourceBadge source={source} /> : null}

			<StatGrid>
				<StatCard icon="🎨" label="Theme tokens" value={total} />
				<StatCard icon="🌈" iconBg="#fef3c7" label="Colour tokens" value={colourTokens} />
				<StatCard icon="⚙️" iconBg="#e0e7ff" label="Scalar tokens" value={scalarTokens} />
			</StatGrid>

			<ThemeActions />

			<Card title="Token palette">
				<div className="pad">
					<ThemeTokenTable tokens={themeTokens} />
				</div>
			</Card>
		</PageShell>
	);
}

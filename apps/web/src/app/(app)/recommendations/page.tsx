import type { NavTile } from "@civitasone/types";
import { LinkTiles } from "../../_components/LinkTiles";
import { PageHeader } from "../../_components/ds";

const sections: NavTile[] = [
	{ title: "Next Best Action", description: "Real-time recommendations for customer interactions.", href: "/recommendations/nba" },
	{ title: "Cross-Sell Matrix", description: "Product affinity rules and cross-sell configurations.", href: "/recommendations/matrix" },
	{ title: "Health Scores", description: "Account health scoring and churn prediction.", href: "/recommendations/health" },
	{ title: "Feedback", description: "Recommendation acceptance/rejection analytics.", href: "/recommendations/feedback" },
];

export default function Page() {
	return (
		<main className="page-main" aria-labelledby="page-heading">
			<PageHeader title="Recommendations" subtitle="AI-powered next-best-action and cross-sell engine." help="recommendations" />
			<LinkTiles tiles={sections} columns="four" />
		</main>
	);
}

import type { NavTile } from "@civitasone/types";
import { LinkTiles } from "../../_components/LinkTiles";
import { PageHeader } from "../../_components/ds";

const sections: NavTile[] = [
	{ title: "Chat", description: "AI chat conversations with context-aware assistance.", href: "/ai/chat" },
	{ title: "Copilot", description: "In-context copilot for document drafting and analysis.", href: "/ai/copilot" },
	{ title: "Agents", description: "Multi-agent workflows and autonomous task execution.", href: "/ai/agents" },
	{ title: "Guardrails", description: "Safety policies, content filtering, and governance.", href: "/ai/guardrails" },
];

export default function Page() {
	return (
		<main className="page-main" aria-labelledby="page-heading">
			<PageHeader title="AI & Copilot" subtitle="Conversational AI, copilot assistance, and multi-agent orchestration." help="ai" />
			<LinkTiles tiles={sections} columns="four" />
		</main>
	);
}

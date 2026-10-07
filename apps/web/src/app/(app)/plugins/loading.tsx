import type { CSSProperties } from "react";

const shimmer: CSSProperties = {
	background: "linear-gradient(90deg,#eef1f4 25%,#e2e6ea 37%,#eef1f4 63%)",
	backgroundSize: "400% 100%",
	animation: "pluginsShimmer 1.4s ease infinite",
	borderRadius: 8,
};

function Bar({ w, h, mb, r }: { w: number | string; h: number; mb?: number; r?: number }) {
	return <div style={{ ...shimmer, width: w, height: h, marginBottom: mb, borderRadius: r ?? 8 }} />;
}

/**
 * GAP-PLUGINS-HOME-02: the plugins hub (/plugins) is tiles-only, but this
 * segment-wide skeleton used to paint three stat blocks plus a five-row table
 * skeleton, so the hub content jumped on load. It now mirrors the hub's actual
 * layout — a header bar and a four-tile grid matching ModuleHub columns="four".
 * The Installed sub-page, which really does show stats + a table, carries its
 * own installed/loading.tsx so it keeps the correct skeleton.
 */
export default function PluginsLoading() {
	return (
		<div className="page-main" aria-busy="true" aria-label="Loading plugins">
			<style>{"@keyframes pluginsShimmer{0%{background-position:100% 0}100%{background-position:0 0}}"}</style>
			<div className="ph">
				<div>
					<Bar w={180} h={28} mb={8} />
					<Bar w={360} h={14} />
				</div>
			</div>
			<div className="grid g-4" style={{ marginTop: 18 }}>
				{Array.from({ length: 4 }).map((_, i) => (
					<div key={i} className="card" style={{ padding: 16 }}>
						<Bar w={40} h={40} mb={12} r={10} />
						<Bar w={110} h={16} mb={10} />
						<Bar w="100%" h={13} />
					</div>
				))}
			</div>
		</div>
	);
}

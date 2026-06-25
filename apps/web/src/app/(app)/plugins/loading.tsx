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

export default function PluginsLoading() {
	return (
		<div className="wrap" aria-busy="true" aria-label="Loading plugins page">
			<style>{"@keyframes pluginsShimmer{0%{background-position:100% 0}100%{background-position:0 0}}"}</style>
			<div className="ph">
				<div>
					<Bar w={180} h={28} mb={8} />
					<Bar w={360} h={14} />
				</div>
			</div>
			<div className="grid g-4" style={{ margin: "18px 0" }}>
				{Array.from({ length: 3 }).map((_, i) => (
					<div key={i} className="card" style={{ padding: 16 }}>
						<Bar w={120} h={13} mb={12} />
						<Bar w={70} h={26} />
					</div>
				))}
			</div>
			<div className="card" style={{ padding: 16 }}>
				<Bar w={200} h={16} mb={16} />
				{Array.from({ length: 5 }).map((_, i) => (
					<Bar key={i} w="100%" h={18} mb={12} />
				))}
			</div>
		</div>
	);
}

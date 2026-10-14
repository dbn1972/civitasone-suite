import { SkeletonBar } from "@/app/_components/ds/Skeleton";

function Bar({ w, h, mb, r }: { w: number | string; h: number; mb?: number; r?: number }) {
  return <SkeletonBar w={w} h={h} style={{ marginBottom: mb, borderRadius: r ?? 8 }} />;
}

/**
 * GAP-PLUGINS-HOME-02: the Installed sub-page shows three stat cards and a
 * table, so it keeps the stat + table skeleton the segment loading.tsx used to
 * render for everyone (which was wrong for the tiles-only hub).
 */
export default function InstalledLoading() {
	return (
		<div className="wrap" aria-busy="true" aria-label="Loading installed plugins">
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

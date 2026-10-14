import type { CSSProperties } from "react";
import { SkeletonBar, SkeletonCard, SkeletonRegion, SkeletonRow, SkeletonTable, TileHubSkeleton } from "./ds/Skeleton";

/**
 * RouteSkeleton — the shared route-level loading placeholder used by every
 * `loading.tsx` (SF-11; enforced by app/loadingSkeletonGuard.test.ts).
 *
 * It composes the ds skeleton primitives, which paint only with the theme
 * tokens (--line/--line2/--panel): no bg-slate-*, no hex, dark mode follows the
 * `.dark` token swap, and the shimmer stops under prefers-reduced-motion
 * (globals-animations.css). There is no page-level background or min-height
 * wrapper, so it inherits the app-shell padding exactly like the loaded page.
 * Accessibility: a polite role="status" region, aria-busy, and a visually
 * hidden localised "Loading" label (msg.loading / msg.loadingData in en/hi).
 *
 * Variants (pick the one that matches the page it stands in for):
 *  - "list" (default): header + stat row + filter bar + table rows.
 *  - "table": header + filter bar + table rows, no stat row.
 *  - "tiles" (alias "hub"): header + tile grid, matching a ModuleHub.
 *  - "dashboard": header + stat row + two content panels.
 *  - "form": header + a card of labelled inputs + action buttons.
 *  - "detail": header + key/value summary card + tabs + content card.
 */
export type RouteSkeletonVariant = "list" | "table" | "tiles" | "hub" | "dashboard" | "form" | "detail";

const GRID = (cols: string, gap = 12): CSSProperties => ({ display: "grid", gridTemplateColumns: cols, gap });

function Header() {
  return (
    <div style={{ marginBottom: 20 }}>
      <SkeletonBar w={120} h={12} style={{ marginBottom: 10 }} />
      <SkeletonBar w={260} h={28} />
    </div>
  );
}

function Panel({ rows = 5 }: { rows?: number }) {
  return (
    <div className="card pad" aria-hidden="true">
      <SkeletonBar w={160} h={16} style={{ marginBottom: 14 }} />
      {Array.from({ length: rows }, (_, i) => (
        <SkeletonRow key={i} />
      ))}
    </div>
  );
}

export function RouteSkeleton({
  variant = "list",
  rows = 8,
  tileRows = 2,
  fields = 6,
  stats = 4,
}: {
  variant?: RouteSkeletonVariant;
  rows?: number;
  tileRows?: number;
  /** form variant: number of placeholder inputs. */
  fields?: number;
  /** list/dashboard variants: number of stat cards in the stat row (default 4). */
  stats?: number;
}) {
  if (variant === "tiles" || variant === "hub") {
    // A single section of a 3-wide grid; `tileRows` rows of tiles (3×2 = 6 by default).
    return (
      <SkeletonRegion live>
        <TileHubSkeleton sections={1} tilesPerSection={tileRows * 3} quiet />
      </SkeletonRegion>
    );
  }
  if (variant === "table") {
    return (
      <SkeletonRegion live>
        <Header />
        <SkeletonTable rows={rows} statCards={0} quiet />
      </SkeletonRegion>
    );
  }
  if (variant === "dashboard") {
    return (
      <SkeletonRegion live>
        <Header />
        <div style={{ ...GRID(`repeat(${stats}, 1fr)`), marginBottom: 20 }}>
          {Array.from({ length: stats }, (_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
        <div style={GRID("repeat(auto-fit, minmax(320px, 1fr))", 16)}>
          <Panel rows={5} />
          <Panel rows={5} />
        </div>
      </SkeletonRegion>
    );
  }
  if (variant === "form") {
    return (
      <SkeletonRegion live>
        <Header />
        <div className="card pad" aria-hidden="true">
          <div style={GRID("repeat(auto-fit, minmax(240px, 1fr))", 16)}>
            {Array.from({ length: fields }, (_, i) => (
              <div key={i}>
                <SkeletonBar w="40%" h={12} style={{ marginBottom: 8 }} />
                <SkeletonBar h={44} />
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
            <SkeletonBar w={110} h={38} style={{ borderRadius: 10 }} />
            <SkeletonBar w={90} h={38} style={{ borderRadius: 10 }} />
          </div>
        </div>
      </SkeletonRegion>
    );
  }
  if (variant === "detail") {
    return (
      <SkeletonRegion live>
        <Header />
        <div className="card pad" aria-hidden="true" style={{ marginBottom: 16 }}>
          <div style={GRID("repeat(auto-fit, minmax(200px, 1fr))", 16)}>
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i}>
                <SkeletonBar w="45%" h={11} style={{ marginBottom: 8 }} />
                <SkeletonBar w="75%" h={16} />
              </div>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, marginBottom: 14 }} aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <SkeletonBar key={i} w={96} h={32} style={{ borderRadius: 8 }} />
          ))}
        </div>
        <Panel rows={4} />
      </SkeletonRegion>
    );
  }
  return (
    <SkeletonRegion live>
      <Header />
      <SkeletonTable rows={rows} statCards={stats} quiet />
    </SkeletonRegion>
  );
}

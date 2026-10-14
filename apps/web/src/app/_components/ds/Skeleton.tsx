import type { CSSProperties, ReactNode } from "react";
import { useTranslations } from "next-intl";

/**
 * Skeleton — shimmer placeholder components for HRMS pages.
 *
 * Uses the design-system CSS variables (--line2, --line, --panel)
 * so the shimmer automatically respects theming.
 *
 * @keyframes sk-shimmer is declared in globals-animations.css; the same
 * shimmer is available to plain markup as the `.skeleton` class
 * (civitas-ds.css). Both honour prefers-reduced-motion and dark mode, because
 * they only use the --line/--line2/--panel tokens.
 */

/**
 * Localised, screen-reader "Loading" label. Falls back to the English literal
 * when no NextIntlClientProvider is mounted (component tests render the ds
 * without one), the same approach DataTable takes.
 */
export function useLoadingLabel(key: "loading" | "loadingData" = "loading"): string {
  const fallback = key === "loadingData" ? "Loading data…" : "Loading…";
  try {
    return useTranslations("msg")(key);
  } catch {
    return fallback;
  }
}

/**
 * SkeletonRegion — the accessible wrapper every skeleton layout sits in:
 * a polite status region, aria-busy, with a visually-hidden "Loading" label
 * for screen readers (the bars themselves are aria-hidden).
 */
export function SkeletonRegion({
  label,
  className,
  style,
  live = false,
  quiet = false,
  children,
}: {
  label?: string;
  className?: string;
  style?: CSSProperties;
  /** Make this a polite role="status" live region. Leave false when an outer element already is one. */
  live?: boolean;
  /** Omit the visually-hidden label (an outer region already announces one). */
  quiet?: boolean;
  children: ReactNode;
}) {
  const fallback = useLoadingLabel("loading");
  const text = label ?? fallback;
  return (
    <div
      role={live ? "status" : undefined}
      aria-live={live ? "polite" : undefined}
      aria-busy="true"
      aria-label={text}
      className={className}
      style={style}
    >
      {children}
      {!quiet && <span className="sr-only">{text}</span>}
    </div>
  );
}

const SHIMMER_BASE: CSSProperties = {
  borderRadius: 6,
  background: "var(--line2)",
  backgroundImage:
    "linear-gradient(90deg, var(--line2) 0%, var(--line) 35%, var(--line2) 70%)",
  backgroundSize: "200% 100%",
  animation: "sk-shimmer 1.5s ease-in-out infinite",
};

function Bar({
  w = "100%",
  h = 14,
  style,
}: {
  w?: string | number;
  h?: number;
  style?: CSSProperties;
}) {
  return (
    <div aria-hidden="true" style={{ ...SHIMMER_BASE, width: w, height: h, ...style }} />
  );
}

/** Public single shimmer bar/block — the primitive the other Skeleton* shapes are built from. */
export { Bar as SkeletonBar };

/** Single shimmer row: name + dept + date + status badge. */
export function SkeletonRow() {
  return (
    <div
      aria-hidden="true"
      style={{
        display: "grid",
        gridTemplateColumns: "2fr 1.5fr 1.2fr 0.8fr",
        gap: 12,
        padding: "12px 0",
        borderBottom: "1px solid var(--line)",
        alignItems: "center",
      }}
    >
      <Bar w="70%" h={13} />
      <Bar w="60%" h={13} />
      <Bar w="55%" h={13} />
      {/* badge */}
      <div style={{ ...SHIMMER_BASE, width: 64, height: 22, borderRadius: 20 }} />
    </div>
  );
}

/** Shimmer stat card — mirrors the .stat card shape. */
export function SkeletonCard() {
  return (
    <div
      aria-hidden="true"
      style={{
        background: "var(--panel)",
        border: "1px solid var(--line)",
        borderRadius: 12,
        padding: 18,
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      {/* icon circle */}
      <div style={{ ...SHIMMER_BASE, width: 42, height: 42, borderRadius: 11 }} />
      <Bar w="55%" h={11} />
      <Bar w="40%" h={22} />
    </div>
  );
}

/** Full table skeleton: 4 stat cards + filter bar + header + N data rows. */
export function SkeletonTable({ rows = 8, statCards = 4, quiet = false }: { rows?: number; statCards?: number; quiet?: boolean }) {
  const label = useLoadingLabel("loadingData");
  return (
    <SkeletonRegion label={label} quiet={quiet} style={{ padding: "4px 0" }}>
      {/* stat cards (statCards={0} renders a plain table skeleton) */}
      {statCards > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${statCards}, 1fr)`,
            gap: 12,
            marginBottom: 20,
          }}
        >
          {Array.from({ length: statCards }, (_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      )}

      {/* filter toolbar */}
      <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
        <div
          style={{
            ...SHIMMER_BASE,
            flex: 1,
            maxWidth: 300,
            height: 38,
            borderRadius: 10,
          }}
        />
        <div style={{ ...SHIMMER_BASE, width: 110, height: 38, borderRadius: 10 }} />
      </div>

      {/* column headers */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "2fr 1.5fr 1.2fr 0.8fr",
          gap: 12,
          padding: "10px 0 10px",
          borderBottom: "2px solid var(--line)",
          marginBottom: 2,
        }}
      >
        {["28%", "38%", "48%", "28%"].map((w, i) => (
          <Bar key={i} w={w} h={10} />
        ))}
      </div>

      {/* data rows */}
      {Array.from({ length: rows }).map((_, i) => (
        <SkeletonRow key={i} />
      ))}
    </SkeletonRegion>
  );
}

/**
 * TileHubSkeleton — loading placeholder for a nav-tile hub page (e.g. the
 * CRM hub). Mirrors the loaded layout: a header bar plus `sections` groups,
 * each with a short section-label bar and a grid of tile placeholders.
 * Renders no stat row, and no page-level background/min-height wrapper, so
 * it inherits the app-shell padding instead of double-padding
 * (GAP-CRM-HOME-04).
 */
export function TileHubSkeleton({
  sections = 5,
  tilesPerSection = 6,
  quiet = false,
}: {
  sections?: number;
  tilesPerSection?: number;
  quiet?: boolean;
}) {
  return (
    <SkeletonRegion className="space-y-6" quiet={quiet}>
      {/* header */}
      <div className="space-y-2">
        <Bar w={180} h={28} />
        <Bar w={300} h={14} />
      </div>
      {Array.from({ length: sections }).map((_, s) => (
        <div key={s} className="space-y-3">
          {/* section label */}
          <Bar w={120} h={11} />
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: 12,
            }}
          >
            {Array.from({ length: tilesPerSection }).map((_, i) => (
              <div
                key={i}
                aria-hidden="true"
                style={{ ...SHIMMER_BASE, height: 96, borderRadius: 12 }}
              />
            ))}
          </div>
        </div>
      ))}
    </SkeletonRegion>
  );
}

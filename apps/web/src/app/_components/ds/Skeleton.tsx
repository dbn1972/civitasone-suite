import type { CSSProperties } from "react";

/**
 * Skeleton — shimmer placeholder components for HRMS pages.
 *
 * Uses the design-system CSS variables (--line2, --line, --panel)
 * so the shimmer automatically respects theming.
 *
 * @keyframes sk-shimmer is declared in globals-animations.css.
 */

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
export function SkeletonTable({ rows = 8 }: { rows?: number }) {
  return (
    <div
      aria-busy="true"
      aria-label="Loading data…"
      style={{ padding: "4px 0" }}
    >
      {/* stat cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 12,
          marginBottom: 20,
        }}
      >
        {[0, 1, 2, 3].map((i) => (
          <SkeletonCard key={i} />
        ))}
      </div>

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
    </div>
  );
}

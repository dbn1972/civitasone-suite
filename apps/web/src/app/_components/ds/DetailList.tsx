/**
 * DetailList -- the shared read-only label/value list for record screens (UX-R5, DS-6 / GLB-14).
 *
 * Replaces the ad-hoc `<div className="field"><span className="label">..</span><span>..</span></div>` markup
 * whose label and value rendered inline and glued together ("Sanction NoW7-SAN-...", "3-Way MatchPending").
 * A real `<dl>`: a fixed, muted label column (170 px) and a bold value, items in a responsive two-column grid
 * that collapses to one column on narrow screens. An empty value reads "—"; an item never pads an empty cell.
 */
import type { CSSProperties, ReactNode } from "react";

export type DetailItem = {
  label: ReactNode;
  value: ReactNode;
  /** Span the full width (remarks, addresses, long references). */
  wide?: boolean;
  /** Tabular / monospace value (record numbers, codes). */
  mono?: boolean;
  /** Stable key when labels are not plain strings. */
  key?: string;
};

export interface DetailListProps {
  items: ReadonlyArray<DetailItem | null | false | undefined>;
  /** 1 = single column; 2 (default) = two columns on wide screens. */
  columns?: 1 | 2;
  /** Accessible name for the list (e.g. "Sanction details"). */
  ariaLabel?: string;
  labelWidth?: number;
  style?: CSSProperties;
}

function isEmpty(value: ReactNode): boolean {
  return value === null || value === undefined || value === false || (typeof value === "string" && value.trim() === "");
}

export function DetailList({ items, columns = 2, ariaLabel, labelWidth = 170, style }: DetailListProps) {
  const shown = items.filter((i): i is DetailItem => Boolean(i));
  return (
    <dl
      aria-label={ariaLabel}
      data-detail-list=""
      style={{
        display: "grid",
        gridTemplateColumns: columns === 2 ? "repeat(auto-fit, minmax(min(100%, 380px), 1fr))" : "1fr",
        columnGap: 24,
        rowGap: 0,
        margin: 0,
        ...style,
      }}
    >
      {shown.map((item, i) => (
        <div
          key={item.key ?? (typeof item.label === "string" ? item.label : i)}
          style={{
            display: "grid",
            gridTemplateColumns: `minmax(120px, ${labelWidth}px) minmax(0, 1fr)`,
            gap: 12,
            padding: "9px 0",
            borderBottom: "1px solid var(--line)",
            gridColumn: item.wide ? "1 / -1" : undefined,
            alignItems: "baseline",
          }}
        >
          <dt style={{ margin: 0, fontSize: 13, color: "var(--ink2)", fontWeight: 500 }}>{item.label}</dt>
          <dd
            className={item.mono ? "mono" : undefined}
            style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "var(--ink)", minWidth: 0, overflowWrap: "anywhere" }}
          >
            {isEmpty(item.value) ? <span style={{ color: "var(--ink2)", fontWeight: 400 }}>—</span> : item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

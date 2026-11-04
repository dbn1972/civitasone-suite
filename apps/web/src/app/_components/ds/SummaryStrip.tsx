/**
 * SummaryStrip -- the slim (about 40 px) summary row that replaces the tall KPI-card row on list and detail
 * pages (UX-R5, DS-7 / GLB-06), so the working table starts above the fold at 1366x768.
 *
 * "19 GRNs · 11 accepted · 1 awaiting inspection · 7 rejected": each item is a count + label and, when it has
 * an href, a filter link. Tone colours only the value; meaning is always in the text.
 */
import Link from "next/link";
import type { ReactNode } from "react";

export type SummaryItem = {
  label: ReactNode;
  value: ReactNode;
  href?: string;
  tone?: "good" | "warn" | "bad" | "info" | "neutral";
  /** Marks the item for the currently applied filter. */
  current?: boolean;
  key?: string;
};

const TONE: Record<NonNullable<SummaryItem["tone"]>, string> = {
  good: "var(--good)",
  warn: "var(--warn)",
  bad: "var(--bad)",
  info: "var(--primary-d, var(--primary))",
  neutral: "var(--ink)",
};

export function SummaryStrip({ items, ariaLabel = "Summary" }: { items: ReadonlyArray<SummaryItem | null | false | undefined>; ariaLabel?: string }) {
  const shown = items.filter((i): i is SummaryItem => Boolean(i));
  if (shown.length === 0) return null;
  return (
    <ul
      aria-label={ariaLabel}
      data-summary-strip=""
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: "4px 0",
        listStyle: "none",
        margin: "0 0 12px",
        padding: "8px 12px",
        minHeight: 40,
        boxSizing: "border-box",
        border: "1px solid var(--line)",
        borderRadius: 10,
        background: "var(--panel)",
        fontSize: 13,
      }}
    >
      {shown.map((item, i) => {
        const body = (
          <>
            <strong style={{ color: TONE[item.tone ?? "neutral"], fontVariantNumeric: "tabular-nums" }}>{item.value}</strong>{" "}
            <span style={{ color: "var(--ink2)" }}>{item.label}</span>
          </>
        );
        return (
          <li key={item.key ?? (typeof item.label === "string" ? item.label : i)} style={{ display: "inline-flex", alignItems: "center" }}>
            {i > 0 ? <span aria-hidden="true" style={{ color: "var(--line2, var(--ink2))", margin: "0 10px" }}>·</span> : null}
            {item.href ? (
              <Link href={item.href} aria-current={item.current ? "true" : undefined} style={{ textDecoration: item.current ? "underline" : "none", minHeight: 24, display: "inline-flex", alignItems: "center" }}>
                {body}
              </Link>
            ) : (
              <span>{body}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

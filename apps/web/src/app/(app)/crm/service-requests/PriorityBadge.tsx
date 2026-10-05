import type { CSSProperties } from "react";

/**
 * Shared priority badge for service requests (list + detail).
 *
 * GAP-CRM-SERVICE-REQUESTS-04: the two badges used to live in two files and
 * both mapped `normal` and `low` to the same `var(--ink2)` grey, so a normal
 * and a low request were indistinguishable by colour. They are now given
 * distinct tones — a filled chip for urgent/high/normal and a lighter outlined
 * chip for low — and the text label is always kept, so the signal is never
 * colour-only.
 */

type PriorityStyle = { background: string; color: string; border: string };

const PRIORITY_STYLE: Record<string, PriorityStyle> = {
  urgent: { background: "var(--bad)", color: "var(--bg)", border: "var(--bad)" },
  high: { background: "var(--warn)", color: "var(--bg)", border: "var(--warn)" },
  // Normal: a solid neutral chip. Low: a lighter *outlined* chip so it reads as
  // less pressing than normal without relying on a near-identical grey fill.
  normal: { background: "var(--ink2)", color: "var(--bg)", border: "var(--ink2)" },
  low: { background: "transparent", color: "var(--ink2)", border: "var(--line)" },
};

function titleCase(v: string): string {
  return v.charAt(0).toUpperCase() + v.slice(1);
}

/**
 * `label` is the already-translated text; callers (client table, server detail
 * page) own the i18n namespace. Falls back to the title-cased enum value.
 */
export function PriorityBadge({ priority, label }: { priority: string; label?: string }) {
  const key = (priority ?? "normal").toLowerCase();
  const s = PRIORITY_STYLE[key] ?? PRIORITY_STYLE.normal;
  const style: CSSProperties = {
    display: "inline-block",
    padding: "2px 8px",
    borderRadius: 4,
    fontSize: 12,
    fontWeight: 600,
    color: s.color,
    background: s.background,
    border: `1px solid ${s.border}`,
  };
  return <span style={style}>{label ?? titleCase(key)}</span>;
}

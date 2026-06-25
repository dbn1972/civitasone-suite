import Link from "next/link";
import type { CSSProperties } from "react";

export type Crumb = { label: string; href?: string };

const nav: CSSProperties = { marginBottom: 4 };
const ol: CSSProperties = { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, listStyle: "none", margin: 0, padding: 0, fontSize: 12.5, color: "var(--ink2)" };
const sep: CSSProperties = { color: "#cbd5e1", userSelect: "none" };
const cur: CSSProperties = { color: "var(--ink2)", fontWeight: 600 };

/** Accessible breadcrumb trail for tenant-admin pages. Self-styled (no shared CSS). */
export function Breadcrumb({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" style={nav}>
      <ol style={ol}>
        {items.map((c, i) => {
          const last = i === items.length - 1;
          return (
            <li key={i} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              {c.href && !last ? (
                <Link href={c.href} style={{ color: "var(--primary-d)", fontWeight: 600 }}>{c.label}</Link>
              ) : (
                <span style={cur} aria-current={last ? "page" : undefined}>{c.label}</span>
              )}
              {!last && <span aria-hidden="true" style={sep}>/</span>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

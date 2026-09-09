import type { ReactNode } from "react";
import type { DataProvenance } from "@/lib/sync/resource";

export type DataSource = "api" | "error";
export type { DataProvenance };

type LegacySourceProps = {
  /**
   * The plain, non-caching two-value shape `fetchJson()` (src/app/_data/apiClient.ts)
   * has always produced. Use this ONLY when nothing downstream of this badge
   * ever falls back to a cached copy for the same data — if it does (any
   * screen paired with a `useSeededResource`-backed table/list), use the
   * `provenance` prop below instead, fed by that SAME hook call, so the two
   * can never disagree about what's on screen (UX-002).
   */
  source: DataSource;
  message?: string;
  provenance?: never;
  cachedAt?: never;
  offline?: never;
};

type ProvenanceProps = {
  /**
   * The single source of truth for data provenance, as derived by
   * `useSeededResource` (src/lib/sync/resource.ts). Pass the SAME value the
   * paired table/list is rendering from — never a separately-derived
   * `source`/`fromCache` pair — so the badge and the data it's describing
   * are guaranteed to agree.
   */
  provenance: DataProvenance;
  /** ISO timestamp of the cached copy, when `provenance === "cached"`. */
  cachedAt?: string | null;
  offline?: boolean;
  /** Override for the "error-no-data" message only; "cached" builds its own honest, non-contradictory copy. */
  message?: string;
  source?: never;
};

type DataSourceBadgeProps = LegacySourceProps | ProvenanceProps;

const badgeClassName =
  "inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800";

function Badge({ children }: { children: ReactNode }) {
  return (
    <span className={badgeClassName} role="status">
      {children}
    </span>
  );
}

/**
 * Tells the clerk, in plain words, when live data couldn't be reached — and,
 * when a cached copy is being shown instead, says exactly that (never both
 * "showing nothing" and "showing saved data" for the same failed fetch;
 * UX-002). When everything is healthy we show nothing — the clerk doesn't
 * need to be told the system is working. Requirement 5.2 (no "API
 * unavailable" / "Live API" wording).
 */
export function DataSourceBadge(props: DataSourceBadgeProps) {
  if (props.provenance !== undefined) {
    const { provenance, cachedAt, offline, message } = props;
    if (provenance === "live") return null;
    if (provenance === "cached") {
      const when = cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : "";
      const offlineNote = offline ? " — you're offline" : "";
      return <Badge>{message ?? `Showing saved data${when} — could not refresh${offlineNote}.`}</Badge>;
    }
    // "error-no-data": nothing loaded and nothing cached — say so plainly.
    return <Badge>{message ?? "Couldn't load — showing nothing"}</Badge>;
  }

  if (props.source !== "error") return null;
  return <Badge>{props.message ?? "Couldn't load — showing nothing"}</Badge>;
}

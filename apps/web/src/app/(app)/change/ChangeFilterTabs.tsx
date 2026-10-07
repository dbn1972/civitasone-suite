import Link from "next/link";

/**
 * GAP-CHANGE-HOME-03: status filter tabs for the change list, rendered as
 * anchor links so the whole page stays a Server Component (the filter is a
 * `?status=` search param read on the server; no client state needed). The
 * selected tab is marked with aria-current so the CAB queue is discoverable
 * instead of hidden behind free-text filtering.
 */
export interface ChangeFilterTabsProps {
  active: string;
  counts: Record<string, number>;
}

const TABS: { key: string; label: string }[] = [
  { key: "all", label: "All" },
  { key: "submitted", label: "Awaiting CAB" },
  { key: "scheduled", label: "Scheduled" },
  { key: "open", label: "Open" },
];

export function ChangeFilterTabs({ active, counts }: ChangeFilterTabsProps) {
  return (
    <div className="seg" role="tablist" aria-label="Filter change requests by status">
      {TABS.map((tab) => {
        const selected = tab.key === active;
        const href = tab.key === "all" ? "/change" : `/change?status=${tab.key}`;
        const count = counts[tab.key];
        return (
          <Link
            key={tab.key}
            href={href}
            role="tab"
            aria-selected={selected}
            aria-current={selected ? "page" : undefined}
            className={selected ? "on" : undefined}
          >
            {tab.label}
            {typeof count === "number" ? ` (${count.toLocaleString("en-IN")})` : ""}
          </Link>
        );
      })}
    </div>
  );
}

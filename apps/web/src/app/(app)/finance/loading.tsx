"use client";

import { usePathname } from "next/navigation";
import { SkeletonBar } from "../../_components/ds";
import { PageSkeleton } from "./_components/PageSkeleton";

/**
 * GAP-FINANCE-HOME-05: the hub (/finance) is a grid of link tiles with no stat
 * cards, so it gets a tile-shaped skeleton. This file is also the generic
 * fallback for every /finance/* child without its own loading.tsx, and those
 * keep the stat-card + table shape below.
 */
function FinanceHubLoading() {
  return (
    <div className="page-main" role="status" aria-live="polite" aria-label="Loading finance hub…">
      <div style={{ marginBottom: 20 }}>
        <SkeletonBar w={120} h={12} style={{ marginBottom: 10 }} />
        <SkeletonBar w={220} h={28} />
      </div>
      {[0, 1].map((sec) => (
        <div key={sec} className="lt-section" aria-hidden="true">
          <SkeletonBar w={140} h={14} style={{ marginBottom: 12 }} />
          <div className="grid g-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
                <SkeletonBar w={36} h={36} style={{ borderRadius: 10 }} />
                <SkeletonBar w="60%" h={14} />
                <SkeletonBar w="90%" h={11} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function FinanceLoading() {
  const pathname = usePathname();
  if (pathname === "/finance" || pathname === "/finance/") return <FinanceHubLoading />;
  // Generic fallback for every /finance/* child: stat cards + table, token-based (SF-11).
  return <PageSkeleton label="Loading finance section…" statCards={4} rows={6} />;
}

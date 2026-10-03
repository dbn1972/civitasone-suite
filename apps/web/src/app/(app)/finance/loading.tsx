"use client";

import { usePathname } from "next/navigation";
import { SkeletonBar } from "../../_components/ds";

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
  return (
    <div
      className="min-h-screen bg-slate-50 p-6 md:p-8"
      style={{ animation: "pulse 2s cubic-bezier(0.4,0,0.6,1) infinite" }}
      role="status"
      aria-live="polite"
      aria-label="Loading finance section…"
    >
      <div className="mx-auto max-w-7xl space-y-6">
        {/* Header skeleton */}
        <div className="space-y-2">
          <div
            className="h-4 w-40 rounded bg-gray-200"
            style={{ animation: "pulse 2s infinite" }}
          />
          <div
            className="h-8 w-64 rounded bg-gray-200"
            style={{ animation: "pulse 2s infinite" }}
          />
        </div>

        {/* 4 stat card skeletons */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="rounded-xl border border-slate-100 bg-white p-5 shadow-sm"
            >
              <div
                className="mb-3 h-4 w-24 rounded bg-gray-200"
                style={{ animation: "pulse 2s infinite" }}
              />
              <div
                className="h-8 w-32 rounded bg-gray-200"
                style={{ animation: "pulse 2s infinite" }}
              />
              <div
                className="mt-2 h-3 w-16 rounded bg-gray-200"
                style={{ animation: "pulse 2s infinite" }}
              />
            </div>
          ))}
        </div>

        {/* Table skeleton */}
        <div
          className="h-96 w-full rounded-xl bg-gray-200"
          style={{ animation: "pulse 2s infinite" }}
        />
      </div>
    </div>
  );
}

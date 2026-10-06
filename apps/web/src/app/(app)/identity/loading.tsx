/**
 * GAP-IDENTITY-HOME-04: the identity group loading state was a bare
 * "Loading identity…" paragraph with no header or skeleton. This mirrors the
 * hub's own shape — a title bar plus a seven-tile grid — using the skeleton
 * pattern established in grants/utilization/loading.tsx, so the transition to
 * the loaded hub doesn't jump. aria-busy announces the loading region.
 */
export default function IdentityLoading() {
  return (
    <div className="page-main" aria-busy="true" aria-label="Loading identity">
      <div className="animate-pulse space-y-5">
        <div className="h-9 w-56 rounded bg-slate-200 dark:bg-slate-700" />
        <div className="h-4 w-96 max-w-full rounded bg-slate-200 dark:bg-slate-700" />
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="h-24 rounded-xl bg-slate-200 dark:bg-slate-700" />
          ))}
        </div>
      </div>
    </div>
  );
}

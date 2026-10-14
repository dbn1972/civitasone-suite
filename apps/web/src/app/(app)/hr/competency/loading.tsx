import { SkeletonBar } from "@/app/_components/ds/Skeleton";

/**
 * GAP-HR-COMPETENCY-06: this used to be a single bare `<div className="skeleton">`
 * with no shape at all -- `.skeleton` has no CSS rule anywhere in
 * apps/web/src (confirmed by grep), so it rendered nothing visible, and
 * PageHeader/stat placeholders were absent, so real content popping in
 * shifted the whole layout. No shared "ListPageLoading" component exists yet
 * in this codebase to depend on (checked: no file exports that name), so
 * this builds an equivalent skeleton scoped to this page instead of adding a
 * new cross-page abstraction as part of an XS-effort single-page fix.
 */
export default function Loading() {
  return (
    <div className="page-main wrap" aria-label="Loading…">
      <SkeletonBar w={240} h={30} style={{ borderRadius: 8, marginBottom: 8 }} />
      <SkeletonBar w={380} h={15} style={{ borderRadius: 6, marginBottom: 20 }} />
      <div className="grid g-4" style={{ marginBottom: 20 }}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="skeleton" style={{ height: 76, borderRadius: 10 }} />
        ))}
      </div>
      <SkeletonBar h={260} style={{ borderRadius: 12, marginBottom: 16 }} />
      <SkeletonBar h={220} style={{ borderRadius: 12, marginBottom: 16 }} />
      <SkeletonBar h={260} style={{ borderRadius: 12 }} />
    </div>
  );
}

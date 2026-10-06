import { SkeletonBar, SkeletonCard } from "@/app/_components/ds";

/**
 * GAP-INSTALL-CONSOLE-04: segment-wide loading placeholder for /install. Uses
 * DS skeleton primitives (--line/--panel tokens, dark-mode safe) instead of
 * hard-coded bg-slate-50 + min-h-screen, so the shimmer respects theming and
 * does not double-pad inside the app shell.
 */
export default function InstallLoading() {
  return (
    <div aria-busy="true" aria-label="Loading…" className="page-main space-y-5">
      <SkeletonBar w={160} h={14} />
      <SkeletonBar w={260} h={28} />
      <div
        style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}
      >
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
      <SkeletonBar w="100%" h={280} style={{ borderRadius: 12 }} />
    </div>
  );
}

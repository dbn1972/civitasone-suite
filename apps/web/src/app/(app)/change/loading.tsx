import { SkeletonBar, SkeletonTable } from "../../_components/ds";

/**
 * GAP-CHANGE-HOME-05: loading state built from the DS Skeleton components
 * (theme-token colours, visible in dark mode) instead of hard-coded Tailwind
 * gray-100/200, matching the loaded page's header + stat grid + table layout.
 */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading change requests">
      <div style={{ marginBottom: 20 }}>
        <SkeletonBar w={240} h={28} />
        <div style={{ marginTop: 8 }}>
          <SkeletonBar w={360} h={14} />
        </div>
      </div>
      <SkeletonTable rows={8} />
    </div>
  );
}

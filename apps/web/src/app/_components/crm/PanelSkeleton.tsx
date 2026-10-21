/**
 * PanelSkeleton - the shared loading placeholder for the CRM detail-page panels
 * (GAP-CRM-CONTACTS-DETAIL-06).
 *
 * The contact detail page mounts a dozen client panels that each fetch after the
 * server render. Each used to show one muted "Loading ..." sentence, so a panel
 * grew from a single text line to its full content when its data resolved - the
 * layout jumped by a whole card per panel. This gives every panel the same
 * shimmer rows (roughly the height of a short list) in a polite, aria-busy
 * status region with a localised screen-reader label, so the reserved space is
 * close to what resolves and the loading state reads consistently.
 */
import type { CSSProperties } from "react";
import { SkeletonBar, SkeletonRegion } from "../ds/Skeleton";

/** Bar widths cycle so the rows look like text, not a block. */
const WIDTHS = ["92%", "78%", "64%", "86%", "70%"];

export function PanelSkeleton({
  rows = 3,
  label,
  style,
}: {
  /** Number of shimmer rows (default 3, max 5). */
  rows?: number;
  /** Screen-reader label; defaults to the localised generic "Loading...". */
  label?: string;
  style?: CSSProperties;
}) {
  const count = Math.max(1, Math.min(rows, WIDTHS.length));
  return (
    <SkeletonRegion
      live
      {...(label ? { label } : {})}
      style={{ display: "grid", gap: 10, padding: "4px 0", ...style }}
    >
      {WIDTHS.slice(0, count).map((w, i) => (
        <SkeletonBar key={i} w={w} h={14} />
      ))}
    </SkeletonRegion>
  );
}

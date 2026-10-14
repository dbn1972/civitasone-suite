import { SkeletonBar } from "@/app/_components/ds/Skeleton";

/**
 * GAP-HR-TRAINING-NEW-04: this used to be the legacy `.ph` dashboard header
 * ("New Training", hard-coded English) plus a 120px hero block + 4 stat
 * tiles + a 240px table -- a skeleton shaped like a totally different page,
 * not this single-column form. Field-row-shaped bars instead, matching what
 * NewTrainingForm.tsx actually renders (title/venue/dates/facilitator/
 * max-participants/category/mode/deadline + submit).
 */
function FieldSkeleton() {
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <SkeletonBar w={90} h={12} style={{ borderRadius: 4 }} />
      <SkeletonBar h={38} style={{ borderRadius: 8 }} />
    </div>
  );
}

export default function Loading() {
  return (
    <div
      className="page-main wrap animate-pulse"
      role="status"
      aria-busy="true"
      aria-label="Loading new training program form"
    >
      <div style={{ display: "grid", gap: 8, marginBottom: 20 }}>
        <SkeletonBar w={260} h={22} style={{ borderRadius: 4 }} />
        <SkeletonBar w={340} h={14} style={{ borderRadius: 4 }} />
      </div>
      <div
        style={{ display: "grid", gap: 16, maxWidth: 672, borderRadius: 12, border: "1px solid var(--line)", padding: 24 }}
      >
        <FieldSkeleton />
        <FieldSkeleton />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <FieldSkeleton />
          <FieldSkeleton />
        </div>
        <FieldSkeleton />
        <FieldSkeleton />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <FieldSkeleton />
          <FieldSkeleton />
        </div>
        <FieldSkeleton />
        <SkeletonBar w={160} h={40} style={{ borderRadius: 8 }} />
      </div>
    </div>
  );
}

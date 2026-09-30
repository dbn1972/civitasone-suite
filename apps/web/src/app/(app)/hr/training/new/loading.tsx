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
      <div style={{ height: 12, width: 90, borderRadius: 4, background: "var(--bg, #f1f5f9)" }} />
      <div style={{ height: 38, borderRadius: 8, background: "var(--bg, #f1f5f9)" }} />
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
        <div style={{ height: 22, width: 260, borderRadius: 4, background: "var(--bg, #f1f5f9)" }} />
        <div style={{ height: 14, width: 340, borderRadius: 4, background: "var(--bg, #f1f5f9)" }} />
      </div>
      <div
        style={{ display: "grid", gap: 16, maxWidth: 672, borderRadius: 12, border: "1px solid var(--line, #e2e8f0)", padding: 24 }}
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
        <div style={{ height: 40, width: 160, borderRadius: 8, background: "var(--bg, #f1f5f9)" }} />
      </div>
    </div>
  );
}

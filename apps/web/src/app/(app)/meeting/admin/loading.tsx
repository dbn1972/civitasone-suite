import { SkeletonBar } from "@/app/_components/ds";

function FieldRow() {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 12,
        padding: "12px 0",
        borderBottom: "1px solid var(--line2)",
      }}
    >
      <div style={{ flex: 1 }}>
        <SkeletonBar w="38%" h={13} style={{ marginBottom: 6 }} />
        <SkeletonBar w="62%" h={11} />
      </div>
      <SkeletonBar w={92} h={34} style={{ borderRadius: 8 }} />
    </div>
  );
}

function GroupCard({ rows }: { rows: number }) {
  return (
    <div
      style={{
        background: "var(--panel)",
        border: "1px solid var(--line)",
        borderRadius: 14,
        padding: 20,
        marginBottom: 16,
      }}
    >
      <SkeletonBar w="30%" h={15} style={{ marginBottom: 14 }} />
      {Array.from({ length: rows }).map((_, i) => (
        <FieldRow key={i} />
      ))}
    </div>
  );
}

/** Shaped for meeting/admin/AdminConfig.tsx: presets card + 4 grouped policy cards. */
export default function Loading() {
  return (
    <div className="page-main wrap" aria-busy="true" aria-label="Loading meeting configuration…">
      <SkeletonBar w={260} h={25} style={{ marginBottom: 8 }} />
      <SkeletonBar w={440} h={14} style={{ marginBottom: 22 }} />

      <div
        style={{
          background: "var(--panel)",
          border: "1px solid var(--line)",
          borderRadius: 14,
          padding: 20,
          marginBottom: 16,
        }}
      >
        <SkeletonBar w="26%" h={15} style={{ marginBottom: 14 }} />
        <div style={{ display: "flex", gap: 8 }}>
          {[0, 1, 2].map((i) => (
            <SkeletonBar key={i} w={140} h={36} style={{ borderRadius: 10 }} />
          ))}
        </div>
      </div>

      <GroupCard rows={2} />
      <GroupCard rows={2} />
      <GroupCard rows={1} />
      <GroupCard rows={3} />
    </div>
  );
}

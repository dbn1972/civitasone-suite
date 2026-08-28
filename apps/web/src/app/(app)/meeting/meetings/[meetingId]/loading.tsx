import { SkeletonBar, SkeletonCard } from "@/app/_components/ds";

function PanelCard({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: "var(--panel)",
        border: "1px solid var(--line)",
        borderRadius: 14,
        padding: 20,
        marginTop: 16,
      }}
    >
      {children}
    </div>
  );
}

/**
 * Shaped for MeetingConsole.tsx: lifecycle header, 4-up stat grid, voting
 * panel, agenda list and an attendance table — the four cards a real console
 * load renders, so the page doesn't jump around when data arrives.
 */
export default function Loading() {
  return (
    <div className="page-main wrap" aria-busy="true" aria-label="Loading meeting console…">
      <SkeletonBar w={90} h={12} style={{ marginBottom: 10 }} />
      <SkeletonBar w={280} h={25} style={{ marginBottom: 22 }} />

      {/* Lifecycle header: status pill + meta on the left, transition buttons on the right */}
      <PanelCard>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <SkeletonBar w={90} h={22} style={{ borderRadius: 20 }} />
            <SkeletonBar w={120} h={13} />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <SkeletonBar w={120} h={38} style={{ borderRadius: 10 }} />
            <SkeletonBar w={90} h={38} style={{ borderRadius: 10 }} />
          </div>
        </div>
      </PanelCard>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginTop: 16 }}>
        {[0, 1, 2, 3].map((i) => (
          <SkeletonCard key={i} />
        ))}
      </div>

      {/* Voting panel */}
      <PanelCard>
        <SkeletonBar w="24%" h={15} style={{ marginBottom: 14 }} />
        <div style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 14 }}>
          <SkeletonBar w="70%" h={14} style={{ marginBottom: 10 }} />
          <SkeletonBar w="100%" h={10} style={{ borderRadius: 6, marginBottom: 12 }} />
          <div style={{ display: "flex", gap: 8 }}>
            <SkeletonBar w={90} h={30} style={{ borderRadius: 8 }} />
            <SkeletonBar w={110} h={30} style={{ borderRadius: 8 }} />
            <SkeletonBar w={95} h={30} style={{ borderRadius: 8 }} />
          </div>
        </div>
      </PanelCard>

      {/* Agenda */}
      <PanelCard>
        <SkeletonBar w="20%" h={15} style={{ marginBottom: 14 }} />
        {[0, 1, 2].map((i) => (
          <div key={i} style={{ display: "flex", gap: 12, padding: "10px 0", borderBottom: "1px solid var(--line2)" }}>
            <SkeletonBar w={20} h={13} />
            <SkeletonBar w="55%" h={13} />
          </div>
        ))}
      </PanelCard>

      {/* Attendance table */}
      <PanelCard>
        <SkeletonBar w="30%" h={15} style={{ marginBottom: 14 }} />
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            style={{
              display: "grid",
              gridTemplateColumns: "2fr 1.2fr 1fr 1fr 0.8fr",
              gap: 12,
              padding: "11px 0",
              borderBottom: "1px solid var(--line2)",
              alignItems: "center",
            }}
          >
            <SkeletonBar w="65%" h={13} />
            <SkeletonBar w="50%" h={13} />
            <SkeletonBar w="45%" h={20} style={{ borderRadius: 20 }} />
            <SkeletonBar w="40%" h={13} />
            <SkeletonBar w={70} h={26} style={{ borderRadius: 8 }} />
          </div>
        ))}
      </PanelCard>
    </div>
  );
}

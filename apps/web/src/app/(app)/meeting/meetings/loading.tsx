import { SkeletonBar } from "@/app/_components/ds";

/** Shaped for meeting/meetings/page.tsx: a back link + header, then a 6-column table. */
export default function Loading() {
  return (
    <div className="page-main wrap" aria-busy="true" aria-label="Loading meetings…">
      <SkeletonBar w={90} h={12} style={{ marginBottom: 10 }} />
      <SkeletonBar w={160} h={25} style={{ marginBottom: 8 }} />
      <SkeletonBar w={460} h={14} style={{ marginBottom: 22 }} />

      <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 14, padding: 20 }}>
        <SkeletonBar w="20%" h={15} style={{ marginBottom: 16 }} />
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "2.2fr 1fr 1.4fr 1fr 1fr 1fr",
            gap: 12,
            padding: "10px 0",
            borderBottom: "2px solid var(--line)",
            marginBottom: 4,
          }}
        >
          {["30%", "40%", "50%", "40%", "50%", "30%"].map((w, i) => (
            <SkeletonBar key={i} w={w} h={10} />
          ))}
        </div>
        {Array.from({ length: 7 }).map((_, i) => (
          <div
            key={i}
            style={{
              display: "grid",
              gridTemplateColumns: "2.2fr 1fr 1.4fr 1fr 1fr 1fr",
              gap: 12,
              padding: "13px 0",
              borderBottom: "1px solid var(--line2)",
              alignItems: "center",
            }}
          >
            <SkeletonBar w="75%" h={13} />
            <SkeletonBar w="55%" h={13} />
            <SkeletonBar w="65%" h={13} />
            <SkeletonBar w="50%" h={20} style={{ borderRadius: 20 }} />
            <SkeletonBar w={70} h={20} style={{ borderRadius: 20 }} />
            <SkeletonBar w="60%" h={13} />
          </div>
        ))}
      </div>
    </div>
  );
}

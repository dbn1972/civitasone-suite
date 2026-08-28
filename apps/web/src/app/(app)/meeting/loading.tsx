import { SkeletonBar, SkeletonCard } from "@/app/_components/ds";

/** Shaped for meeting/page.tsx: header, a 4-up stat grid, then two console tiles. */
export default function Loading() {
  return (
    <div className="page-main wrap" aria-busy="true" aria-label="Loading meeting management…">
      <SkeletonBar w={220} h={25} style={{ marginBottom: 8 }} />
      <SkeletonBar w={420} h={14} style={{ marginBottom: 22 }} />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 12,
          marginBottom: 18,
        }}
      >
        {[0, 1, 2, 3].map((i) => (
          <SkeletonCard key={i} />
        ))}
      </div>

      <div
        style={{
          display: "grid",
          gap: 16,
          gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))",
        }}
      >
        {[0, 1].map((i) => (
          <div
            key={i}
            style={{
              background: "var(--panel)",
              border: "1px solid var(--line)",
              borderRadius: 14,
              padding: 20,
            }}
          >
            <SkeletonBar w={30} h={30} style={{ borderRadius: 8, marginBottom: 10 }} />
            <SkeletonBar w="60%" h={16} style={{ marginBottom: 8 }} />
            <SkeletonBar w="95%" h={12} style={{ marginBottom: 6 }} />
            <SkeletonBar w="80%" h={12} />
          </div>
        ))}
      </div>
    </div>
  );
}

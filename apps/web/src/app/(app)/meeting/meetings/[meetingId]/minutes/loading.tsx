import { Fragment } from "react";
import { SkeletonBar } from "@/app/_components/ds";

/**
 * Shaped for MinutesPanel.tsx: a metadata grid, a large content block and
 * action buttons, then the vote-records table underneath.
 */
export default function Loading() {
  return (
    <div className="page-main wrap" aria-busy="true" aria-label="Loading minutes…">
      <SkeletonBar w={90} h={12} style={{ marginBottom: 10 }} />
      <SkeletonBar w={300} h={25} style={{ marginBottom: 22 }} />

      <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 14, padding: 20, marginBottom: 16 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "auto 1fr",
            gap: "10px 16px",
            marginBottom: 16,
          }}
        >
          {[0, 1, 2, 3].map((i) => (
            <Fragment key={i}>
              <SkeletonBar w={90} h={11} />
              <SkeletonBar w={140} h={11} />
            </Fragment>
          ))}
        </div>
        <SkeletonBar w={140} h={11} style={{ marginBottom: 8 }} />
        <SkeletonBar w="100%" h={220} style={{ borderRadius: 8, marginBottom: 16 }} />
        <div style={{ display: "flex", gap: 8 }}>
          <SkeletonBar w={110} h={38} style={{ borderRadius: 10 }} />
          <SkeletonBar w={150} h={38} style={{ borderRadius: 10 }} />
        </div>
      </div>

      <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 14, padding: 20 }}>
        <SkeletonBar w="26%" h={15} style={{ marginBottom: 14 }} />
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            style={{
              display: "grid",
              gridTemplateColumns: "0.6fr 3fr 0.6fr 0.8fr 0.8fr 1fr",
              gap: 12,
              padding: "11px 0",
              borderBottom: "1px solid var(--line2)",
              alignItems: "center",
            }}
          >
            <SkeletonBar w="60%" h={12} />
            <SkeletonBar w="85%" h={12} />
            <SkeletonBar w="50%" h={12} />
            <SkeletonBar w="50%" h={12} />
            <SkeletonBar w="50%" h={12} />
            <SkeletonBar w="60%" h={20} style={{ borderRadius: 20 }} />
          </div>
        ))}
      </div>
    </div>
  );
}

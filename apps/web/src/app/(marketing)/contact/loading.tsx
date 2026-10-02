import { SkeletonBar } from "@/app/_components/ds";

/** Skeleton for the public contact page. */
export default function ContactLoading() {
  return (
    <div
      aria-busy="true"
      aria-label="Loading"
      style={{ maxWidth: 960, margin: "0 auto", padding: "48px 16px", display: "grid", gap: 16 }}
    >
      <SkeletonBar w="45%" h={32} />
      <SkeletonBar w="70%" h={16} />
      <SkeletonBar h={180} style={{ borderRadius: 12 }} />
      <SkeletonBar w="85%" h={16} />
      <SkeletonBar w="60%" h={16} />
    </div>
  );
}

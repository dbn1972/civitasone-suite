import { SkeletonTable } from "@/app/_components/ds";

export default function Loading() {
  return (
    <div className="wrap">
      <div className="ph" style={{ marginBottom: 20 }}>
        <div className="skeleton" style={{ height: 28, width: 220, borderRadius: 6 }} />
        <div className="skeleton" style={{ height: 18, width: 320, borderRadius: 6, marginTop: 6 }} />
      </div>
      <SkeletonTable rows={8} />
    </div>
  );
}

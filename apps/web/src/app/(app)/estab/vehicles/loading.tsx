import { SkeletonBar, SkeletonTable } from "@/app/_components/ds";

/**
 * GAP-ESTAB-VEHICLES-05: a page-shaped loading skeleton (header + four stat
 * tiles + table) instead of falling back to the generic estab tile-hub
 * skeleton, so the placeholder matches the loaded fleet page.
 */
export default function VehiclesLoading() {
  return (
    <div className="page-main wrap">
      <div style={{ marginBottom: 18 }}>
        <SkeletonBar w={220} h={26} />
        <div style={{ marginTop: 8 }}>
          <SkeletonBar w={360} h={14} />
        </div>
      </div>
      <SkeletonTable rows={6} />
    </div>
  );
}

import { SkeletonBar } from "@/app/_components/ds/Skeleton";

/**
 * GAP-CRM-DOCUMENT-TYPES-05 / GAP-CRM-DOCUMENTS-04: the loaded Documents page is
 * a PageHeader (title + subtitle) over the cross-record register card and a
 * guidance card — no stat tiles. The old skeleton drew four 80px tiles + a
 * 280px block, so a tile grid flashed before the real cards. This mirrors the
 * real structure (header with subtitle, a register-shaped card, a text card)
 * using the design-system line token so there is no tile flash or CLS jump.
 */
export default function Loading() {
  return (
    <div className="page-main" aria-busy="true">
      <div className="ph">
        <div style={{ display: "grid", gap: 8 }}>
          <h1 id="page-heading">Documents</h1>
          <SkeletonBar w={360} h={14} style={{ borderRadius: 6 }} />
        </div>
      </div>
      <div className="animate-pulse" style={{ display: "grid", gap: 16 }}>
        {/* Register card: a filter row + a table block. */}
        <div className="card">
          <div className="pad" style={{ display: "grid", gap: 12 }}>
            <SkeletonBar w="60%" h={36} style={{ borderRadius: 8 }} />
            <SkeletonBar h={220} style={{ borderRadius: 12 }} />
          </div>
        </div>
        {/* Guidance text card: a few text lines + a button row. */}
        <div className="card">
          <div className="pad" style={{ display: "grid", gap: 10 }}>
            <SkeletonBar h={14} style={{ borderRadius: 6 }} />
            <SkeletonBar w="85%" h={14} style={{ borderRadius: 6 }} />
            <SkeletonBar w="70%" h={14} style={{ borderRadius: 6 }} />
            <SkeletonBar w={220} h={40} style={{ borderRadius: 8, marginTop: 4 }} />
          </div>
        </div>
      </div>
    </div>
  );
}

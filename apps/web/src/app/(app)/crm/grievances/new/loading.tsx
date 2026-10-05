import { SkeletonBar } from "../../../../_components/ds/Skeleton";
import { useTranslations } from "next-intl";

/**
 * GAP-CRM-GRIEVANCES-NEW-06: the loaded page is a PageHeader plus a single
 * form card at maxWidth 640, but the old skeleton was byte-identical to the
 * register's `max-w-7xl` table skeleton (an h-80 full-width block) and used
 * hard-coded slate-200 classes — so the new-grievance route flashed a
 * table-shaped, wrong-width, non-themed skeleton that jumped on load. This
 * skeleton matches the real form: a header, then a 640px card with field bars
 * and a button bar, painted with ds Skeleton theme tokens.
 */
export default function NewGrievanceLoading() {
  const t = useTranslations("crm.loading");
  const field = (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <SkeletonBar w={120} h={12} />
      <SkeletonBar w="100%" h={38} />
    </div>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* breadcrumb + title */}
      <SkeletonBar w={160} h={13} />
      <SkeletonBar w={200} h={28} />
      {/* form card — same 640px max width as the loaded form */}
      <div
        aria-busy="true"
        aria-label={t("form")}
        style={{
          background: "var(--panel)",
          border: "1px solid var(--line)",
          borderRadius: "var(--r)",
          padding: "24px 28px",
          maxWidth: 640,
          display: "flex",
          flexDirection: "column",
          gap: 18,
        }}
      >
        {field}
        {field}
        {field}
        {field}
        {field}
        {/* button bar */}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <SkeletonBar w={90} h={38} />
          <SkeletonBar w={150} h={38} />
        </div>
      </div>
    </div>
  );
}

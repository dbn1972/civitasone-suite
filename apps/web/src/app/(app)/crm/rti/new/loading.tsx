import { PageHeader, SkeletonBar } from "../../../../_components/ds";
import { useTranslations } from "next-intl";

// GAP-CRM-RTI-NEW-06: a form-shaped skeleton for the new-request route, instead
// of inheriting the register's list skeleton (4 stat tiles + table) which does
// not match this single-form page.
export default function Loading() {
  const t = useTranslations("crm.loading");
  return (
    <>
      <PageHeader
        title={t("rtiNewTitle")}
        subtitle={t("rtiNewSubtitle")}
        back="/crm/rti"
        backLabel={t("backRti")}
      />
      <div
        aria-busy="true"
        aria-label={t("rtiForm")}
        style={{
          background: "var(--panel)",
          border: "1px solid var(--line)",
          borderRadius: "var(--r)",
          padding: "24px 28px",
          maxWidth: 680,
          display: "grid",
          gap: 16,
        }}
      >
        <SkeletonBar w="30%" h={14} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <SkeletonBar h={40} />
          <SkeletonBar h={40} />
        </div>
        <SkeletonBar h={40} />
        <SkeletonBar h={96} />
        <SkeletonBar w="30%" h={14} />
        <SkeletonBar h={40} />
        <SkeletonBar h={40} />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <SkeletonBar w={90} h={38} />
          <SkeletonBar w={130} h={38} />
        </div>
      </div>
    </>
  );
}

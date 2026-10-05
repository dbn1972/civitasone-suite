import { PageHeader, SkeletonBar } from "../../../../_components/ds";
import { useTranslations } from "next-intl";

// GAP-CRM-SERVICE-REQUESTS-06: a form-shaped skeleton instead of the generic
// three-bar template.
export default function Loading() {
  const t = useTranslations("crm.loading");
  return (
    <div aria-busy="true" aria-label={t("newServiceRequest")}>
      <PageHeader title={t("newServiceRequestTitle")} back="/crm/service-requests" backLabel={t("backServiceRequests")} />
      <div
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
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <SkeletonBar h={40} />
          <SkeletonBar h={40} />
        </div>
        <SkeletonBar h={40} />
        <SkeletonBar h={96} />
        <SkeletonBar h={40} />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <SkeletonBar w={90} h={38} />
          <SkeletonBar w={130} h={38} />
        </div>
      </div>
    </div>
  );
}

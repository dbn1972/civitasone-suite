import { PageHeader, Card, SkeletonBar } from "../../../../_components/ds";
import { useTranslations } from "next-intl";

// GAP-CRM-SERVICE-REQUESTS-06: a detail-shaped skeleton (header + two cards)
// instead of the generic three-bar template.
export default function Loading() {
  const t = useTranslations("crm.loading");
  return (
    <div aria-busy="true" aria-label={t("serviceRequest")}>
      <PageHeader title={t("serviceRequestTitle")} back="/crm/service-requests" backLabel={t("backServiceRequests")} />
      <div className="detail-split">
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Card title={t("requestDetails")}>
            <div style={{ display: "grid", gap: 10, padding: "12px 16px" }}>
              {[0, 1, 2, 3, 4].map((i) => (
                <SkeletonBar key={i} w="100%" h={16} />
              ))}
            </div>
          </Card>
          <Card title={t("descriptionTitle")}>
            <div style={{ padding: "12px 16px" }}>
              <SkeletonBar w="90%" h={60} />
            </div>
          </Card>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Card title={t("statusTitle")}>
            <div style={{ display: "grid", gap: 10, padding: "12px 16px" }}>
              <SkeletonBar w="60%" h={16} />
              <SkeletonBar w="80%" h={38} />
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

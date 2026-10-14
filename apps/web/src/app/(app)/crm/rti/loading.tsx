import { getTranslations } from "next-intl/server";
import { PageHeader, SkeletonBar } from "../../../_components/ds";

export default async function RtiLoading() {
  const t = await getTranslations("crmRtiList");
  return (
    <>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/crm"
      />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: 12,
          marginBottom: 20,
        }}
      >
        {[1, 2, 3, 4].map((i) => (
          <SkeletonBar key={i} h={72} style={{ borderRadius: "var(--r)", border: "1px solid var(--line)" }} />
        ))}
      </div>
      <SkeletonBar h={320} style={{ borderRadius: "var(--r)", border: "1px solid var(--line)" }} />
    </>
  );
}

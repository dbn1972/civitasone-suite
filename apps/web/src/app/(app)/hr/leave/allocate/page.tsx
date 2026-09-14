import { PageHeader, Card } from "../../../../_components/ds";
import { AllocateLeaveForm } from "./AllocateLeaveForm";
import { getTranslations } from "next-intl/server";

export default async function AllocateLeavePage() {
  const t = await getTranslations("leaveAllocate");
  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr/leave"
        backLabel={t("backLabel")}
      />
      <Card title={t("newAllocationCard")}>
        <div style={{ padding: "4px 0 8px" }}>
          <AllocateLeaveForm />
        </div>
      </Card>
    </main>
  );
}

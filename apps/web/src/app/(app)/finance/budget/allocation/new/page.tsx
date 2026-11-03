import { getTranslations } from "next-intl/server";
import { PageHeader, Card, EmptyState } from "@/app/_components/ds";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { canWrite, ALLOCATION_WRITE_ROLES } from "@/lib/finance/writeRoles";
import { NewAllocationForm } from "./NewAllocationForm";

/** UAT P2 (J7): New budget allocation (head + FY + amount). */
export default async function NewAllocationPage() {
  const t = await getTranslations("budgetAllocationNew");
  const allowed = canWrite(getSessionRoles(), ALLOCATION_WRITE_ROLES);
  return (
    <div className="page-main wrap">
      <PageHeader title={t("title")} subtitle={t("subtitle")} back="/finance/budget/allocation" backLabel={t("back")} />
      {allowed ? (
        <NewAllocationForm />
      ) : (
        <Card>
          <EmptyState icon="🔒" title={t("deniedTitle")} message={t("deniedMessage")} />
        </Card>
      )}
    </div>
  );
}

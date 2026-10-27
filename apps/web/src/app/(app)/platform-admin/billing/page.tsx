import { getTranslations } from "next-intl/server";
import { PageHeader, RefreshErrorState } from "@/app/_components/ds";
import { Breadcrumb } from "../Breadcrumb";
import { DowngradeQueue, type PendingDowngrade } from "./DowngradeQueue";
import { getPendingDowngradeRequests } from "@/app/_data/loaders";
import { requireAnyRole } from "@/lib/auth/roleGuard";
import { toHumanError } from "@/lib/messages";

// tenant-service lets only these two roles read the queue and decide (not tenant_admin),
// so the page admits exactly them rather than the wider PLATFORM_ADMIN_ROLES.
const BILLING_ROLES = ["platform_admin", "super_admin"];

export default async function PlatformBillingPage() {
  requireAnyRole(BILLING_ROLES, "/dashboard");
  const t = await getTranslations("tenantW3.billing");
  const { data, source } = await getPendingDowngradeRequests();

  return (
    <div className="page-main wrap">
      <Breadcrumb items={[{ label: "Platform Admin", href: "/platform-admin" }, { label: t("title") }]} />
      <PageHeader back="/platform-admin" title={t("title")} subtitle={t("subtitle")} />
      {source === "error" ? (
        <RefreshErrorState
          error={toHumanError("load", { area: "downgrade requests" })}
          backHref="/platform-admin"
          source={{ area: "downgrade requests", status: 500 }}
        />
      ) : (
        <DowngradeQueue rows={data as PendingDowngrade[]} />
      )}
    </div>
  );
}

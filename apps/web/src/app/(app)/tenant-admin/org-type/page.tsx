import { PageHeader, Card, RefreshErrorState } from "../../../_components/ds";
import { requireAnyRole } from "@/lib/auth/roleGuard";
import { getCurrentTenantOrgType } from "@/app/_data/loaders";
import { toResourceState } from "@/app/_data/useResource";
import { toHumanError } from "@/lib/messages";
import { OrgTypeSelector } from "./OrgTypeSelector";

export default async function OrgTypePage() {
  requireAnyRole(["admin", "tenant_admin", "platform_admin", "super_admin"]);

  const result = await getCurrentTenantOrgType();
  const { data } = result;
  const errored = toResourceState(result).status === "error";

  return (
    <div className="page-main wrap">
      <PageHeader
        title="Organisation Type"
        subtitle="Choose what kind of organisation you are — this adjusts terminology, default policies, and which features are shown."
        back="/tenant-admin"
        backLabel="Office Admin"
      />

      <Card padding>
        <p style={{ margin: "0 0 16px", color: "var(--ink)", fontSize: 14.5, lineHeight: 1.6 }}>
          CivitasOne adapts to your organisation type. Pick the one that best describes you — the system
          will use the right words, show relevant features, and hide what doesn&apos;t apply. Your current
          type is marked <strong>Current</strong>.
        </p>

        {errored ? (
          <RefreshErrorState error={toHumanError("load", { area: "organisation type" })} backHref="/tenant-admin" />
        ) : (
          <OrgTypeSelector currentType={data.orgType} tenantId={data.tenantId} settings={data.settings} />
        )}
        {/* GAP-TENANT-ADMIN-ORG-TYPE-02: the developer PATCH snippet / "coming
            soon" note is gone — the selector above is the real, working control. */}
      </Card>
    </div>
  );
}

import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader } from "@/app/_components/ds";
import { requireAnyRole, MEETING_CONFIG_ADMIN_ROLES } from "@/lib/auth/roleGuard";
import { getConfigNamespace } from "../_data/loaders";
import { COMMITTEE_TYPES_NS, POLICY_NS } from "../_data/policy";
import { AdminConfig } from "./AdminConfig";

export const dynamic = "force-dynamic";

export default async function MeetingAdminConfigPage() {
  // GAP-MEETING-HOME-04 / GAP-MEETING-ADMIN-02: gate the page server-side, not
  // just by hiding the tile. meeting-service already 403s a non-admin write
  // (config-registry CONFIG_WRITE_ROLES); this stops a plain member reaching
  // the editable controls at all and redirects them away.
  requireAnyRole(MEETING_CONFIG_ADMIN_ROLES, "/meeting");

  const [policy, committeeTypes] = await Promise.all([
    getConfigNamespace(POLICY_NS),
    getConfigNamespace(COMMITTEE_TYPES_NS),
  ]);

  const entries = [...policy.data, ...committeeTypes.data];
  const source = policy.source === "error" || committeeTypes.source === "error" ? "error" : "api";

  return (
    <>
      <PageHeader
        title="Meeting Configuration"
        subtitle="Tune the policies that govern agendas, minutes, escalation and the committee types this tenant may constitute."
        back="/meeting"
        backLabel="Meeting"
      />
      {source === "error" && (
        <DataSourceBadge source={source} message="Couldn't load — showing defaults below" />
      )}
      <AdminConfig initialEntries={entries} initialSource={source} />
    </>
  );
}

import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader } from "@/app/_components/ds";
import { getConfigNamespace } from "../_data/loaders";
import { COMMITTEE_TYPES_NS, POLICY_NS } from "../_data/policy";
import { AdminConfig } from "./AdminConfig";

export const dynamic = "force-dynamic";

export default async function MeetingAdminConfigPage() {
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

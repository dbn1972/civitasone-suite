import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader } from "@/app/_components/ds";
import { getConfigNamespace } from "../_data/loaders";
import { APPROVAL_NS, POLICY_NS } from "../_data/policy";
import { AdminConfig } from "./AdminConfig";

export const dynamic = "force-dynamic";

export default async function AdminConfigPage() {
  const [policy, approval] = await Promise.all([
    getConfigNamespace(POLICY_NS),
    getConfigNamespace(APPROVAL_NS),
  ]);

  const entries = [...policy.data, ...approval.data];
  const source = policy.source === "error" || approval.source === "error" ? "error" : "api";

  return (
    <>
      <PageHeader
        title="Visitor Configuration"
        subtitle="Tune the policies that govern visitor requests, approvals, overstay and passes."
        back="/visitor"
        backLabel="Visitor"
      />
      {source === "error" && <DataSourceBadge source={source} />}
      <AdminConfig initialEntries={entries} initialSource={source} />
    </>
  );
}

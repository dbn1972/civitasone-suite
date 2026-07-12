import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader } from "@/app/_components/ds";
import { getConfigNamespace } from "../_data/loaders";
import { ENUM_NAMESPACE_KEYS, SLA_NS } from "../_data/policy";
import { AdminConfig } from "./AdminConfig";

export const dynamic = "force-dynamic";

export default async function CourtAdminConfigPage() {
  const namespaces = [...ENUM_NAMESPACE_KEYS, SLA_NS];
  const results = await Promise.all(namespaces.map((ns) => getConfigNamespace(ns)));

  const entries = results.flatMap((r) => r.data);
  const source = results.some((r) => r.source === "error") ? "error" : "api";

  return (
    <>
      <PageHeader
        title="Court Configuration"
        subtitle="Manage the §47 config engine — the value lists for case, court and order types, hearing purposes, party roles and evidence, plus the disposal SLA — or seed a vertical preset."
        back="/court"
        backLabel="Court"
      />
      {source === "error" && <DataSourceBadge source={source} />}
      <AdminConfig initialEntries={entries} initialSource={source} />
    </>
  );
}

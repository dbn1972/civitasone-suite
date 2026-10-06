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
  // GAP-COURT-ADMIN-04: per-namespace health, so one failed namespace shows a
  // per-card "couldn't load" (and disables Add/Retire) instead of silently
  // falling back to built-in defaults as if that namespace were simply empty.
  const sources: Record<string, "api" | "error"> = {};
  namespaces.forEach((ns, i) => {
    sources[ns] = results[i].source;
  });
  // The global badge appears only when EVERY namespace failed.
  const allError = results.every((r) => r.source === "error");

  return (
    <>
      <PageHeader
        title="Court Configuration"
        subtitle="Manage the §47 config engine — the value lists for case, court and order types, hearing purposes, party roles and evidence, plus the disposal SLA — or seed a vertical preset."
        back="/court"
        backLabel="Court"
      />
      {allError && <DataSourceBadge source="error" />}
      <AdminConfig initialEntries={entries} initialSources={sources} allError={allError} />
    </>
  );
}

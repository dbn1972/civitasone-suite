import { PageHeader } from "@/app/_components/ds";
import { getSAEditions } from "@/app/_data/loaders";
import { EditionsTable } from "./EditionsTable";
import { AdminAccessDenied, sessionHasAnyRole } from "../_components/AdminAccessGate";
import { PLATFORM_ADMIN_ROLES } from "@/lib/auth/adminRoles";

export default async function EditionsPage() {
  // GAP-ADMIN-EDITIONS-01: platform-operator screen -- gate before any loader runs so an
  // unauthorized caller sees "Access restricted", not operator chrome.
  if (!sessionHasAnyRole(PLATFORM_ADMIN_ROLES)) {
    return <AdminAccessDenied title="Edition Catalog" area="the edition catalog" roles={PLATFORM_ADMIN_ROLES} />;
  }
  const res = await getSAEditions();

  return (
    <div className="page-main wrap">
      {/* GAP-ADMIN-EDITIONS-02: cards, data-source badge and failure state all live in
          EditionsTable, driven by the same useSeededResource call as its rows. */}
      <PageHeader title="Edition Catalog" subtitle="Platform editions with module bundles, pricing and tenant allocation." back="/admin" />
      <EditionsTable
        editions={res.data}
        source={res.source === "error" ? "error" : "api"}
        status={res.status}
        errorMessage={res.errorMessage}
      />
    </div>
  );
}

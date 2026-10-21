import { redirect } from "next/navigation";

// GAP-TENANT-ORG-HIERARCHY-01: the tenant service's /org/hierarchy payload shape is
// unconfirmed; a working tree view already exists at /tenant-admin/org-hierarchy.
// Redirect rather than show a broken flat table.
export const dynamic = "force-dynamic";

export default function Page() {
  redirect("/tenant-admin/org-hierarchy");
}

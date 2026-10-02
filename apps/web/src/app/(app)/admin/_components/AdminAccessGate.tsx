import { PageHeader } from "@/app/_components/ds";
import { PermissionDenied } from "@/app/_components/PermissionDenied";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { rolesAllow } from "@/lib/auth/adminRoles";

/** Server-side: does the signed-in session hold any of `allowed`? */
export function sessionHasAnyRole(allowed: readonly string[]): boolean {
  return rolesAllow(getSessionRoles(), allowed);
}

/**
 * The "Access restricted" page body for a platform-admin screen the caller
 * may not see. Pages call `sessionHasAnyRole` BEFORE running their loaders
 * and return this instead, so no operator data is fetched or rendered for an
 * unauthorized caller (the backend still 403s regardless).
 */
export function AdminAccessDenied({ title, area, roles }: { title: string; area: string; roles: readonly string[] }) {
  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title={title} back="/admin" />
      <PermissionDenied module={area} requiredRoles={[...roles]} backHref="/admin" backLabel="Back to Admin" />
    </div>
  );
}

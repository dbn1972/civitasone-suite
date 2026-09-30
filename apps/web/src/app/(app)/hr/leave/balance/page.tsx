import { getSessionRoles } from "@/lib/auth/roleGuard";
import { getMyProfile } from "../../../../_data/loaders";
import LeaveBalanceClient from "./LeaveBalanceClient";

/**
 * Server wrapper: resolves session roles and the actor's employee id,
 * then hands them to the client component which scopes its data fetch
 * accordingly (employees see only their own balance; admins/managers
 * get the full employee picker).
 */
export default async function LeaveBalancePage({
  searchParams,
}: {
  searchParams?: Record<string, string>;
}) {
  const roles = getSessionRoles();
  const profile = await getMyProfile();
  // GAP-HR-LEAVE-BALANCE-04: getMyProfile() normalizes a genuine 404 ("no
  // employee record linked to this account") to source:"api", data: null --
  // same rule apply/page.tsx already uses -- so only a REAL fetch failure
  // (source:"error") is treated as an error state; a plain employee with no
  // linked record gets the honest "contact HR" empty state instead of a
  // silently blank page.
  const noLinkedProfile = !profile.data && profile.source !== "error";

  return (
    <LeaveBalanceClient
      roles={roles}
      myEmployeeId={profile.data?.id ?? null}
      initialEmployeeId={searchParams?.empId}
      noLinkedProfile={noLinkedProfile}
      profileSource={profile.source}
    />
  );
}

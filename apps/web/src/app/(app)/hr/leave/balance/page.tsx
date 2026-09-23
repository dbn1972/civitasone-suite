import { getSessionRoles } from "@/lib/auth/roleGuard";
import { getMyProfile } from "../../../../_data/loaders";
import LeaveBalanceClient from "./LeaveBalanceClient";

/**
 * Server wrapper: resolves session roles and the actor's employee id,
 * then hands them to the client component which scopes its data fetch
 * accordingly (employees see only their own balance; admins/managers
 * get the full employee picker).
 */
export default async function LeaveBalancePage() {
  const roles = getSessionRoles();
  const profile = await getMyProfile();

  return (
    <LeaveBalanceClient
      roles={roles}
      myEmployeeId={profile.data?.id ?? null}
    />
  );
}

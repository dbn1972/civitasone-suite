import { getSessionRoles } from "@/lib/auth/roleGuard";
import { getMyProfile } from "../../../../_data/loaders";
import LeaveHistoryClient from "./LeaveHistoryClient";

/**
 * Server wrapper: resolves session roles and the actor's employee id,
 * then hands them to the client component which scopes its data fetch
 * accordingly (employees see only their own history; admins/managers
 * get the full employee picker).
 */
export default async function LeaveHistoryPage() {
  const roles = getSessionRoles();
  const profile = await getMyProfile();

  return (
    <LeaveHistoryClient
      roles={roles}
      myEmployeeId={profile.data?.id ?? null}
    />
  );
}

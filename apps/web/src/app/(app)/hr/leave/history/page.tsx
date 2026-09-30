import { getSessionRoles } from "@/lib/auth/roleGuard";
import { getMyProfile } from "../../../../_data/loaders";
import LeaveHistoryClient from "./LeaveHistoryClient";

/**
 * Server wrapper: resolves session roles and the actor's employee id,
 * then hands them to the client component which scopes its data fetch
 * accordingly (employees see only their own history; admins/managers
 * get the full employee picker).
 */
export default async function LeaveHistoryPage({
  searchParams,
}: {
  searchParams?: Record<string, string>;
}) {
  const roles = getSessionRoles();
  const profile = await getMyProfile();
  // GAP-HR-LEAVE-BALANCE-04 (applies to history too, per that item's own
  // fix steps): same noLinkedProfile rule as balance/page.tsx and
  // leave/apply/page.tsx.
  const noLinkedProfile = !profile.data && profile.source !== "error";

  return (
    <LeaveHistoryClient
      roles={roles}
      myEmployeeId={profile.data?.id ?? null}
      initialEmployeeId={searchParams?.empId}
      noLinkedProfile={noLinkedProfile}
      profileSource={profile.source}
    />
  );
}

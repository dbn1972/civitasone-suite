import { StatCard, StatGrid } from "../../_components/ds";
import { getSessionRoles, hasAnyRole } from "@/lib/auth/roleGuard";
import { getIdentityPosture } from "./_data";

/**
 * GAP-IDENTITY-HOME-03 (owner-approved B30): active users and MFA-enrolled share,
 * for tenant_admin only. Renders nothing for any other role and never calls the
 * API for them. A failed fetch shows "—", not a fabricated zero.
 */
export async function IdentityPosture() {
  if (!hasAnyRole(getSessionRoles(), ["tenant_admin"])) return null;
  const { data, source } = await getIdentityPosture();
  const ok = source === "api" && data !== null;
  return (
    <StatGrid>
      <StatCard icon="👥" tone="info" label="Active users" value={ok ? data.activeUsers : null} />
      <StatCard
        icon="📱"
        tone="good"
        label="MFA enrolled"
        hint="Share of active users who have multi-factor sign-in enabled."
        value={ok ? `${data.mfaAdoptionRate}%` : null}
      />
    </StatGrid>
  );
}

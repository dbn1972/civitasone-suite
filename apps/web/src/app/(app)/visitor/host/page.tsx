import { PageHeader, RefreshErrorState } from "@/app/_components/ds";
import { getSessionUserId, getSessionRoles, hasAnyRole } from "@/lib/auth/roleGuard";
import { getVisitRequests, getVisitorLocations } from "../_data/loaders";
import { isToday } from "../_data/format";
import { HostPortal } from "./HostPortal";

export const dynamic = "force-dynamic";

// Roles that may approve/reject ANY host's request (mirror visitor-service
// ELEVATED_APPROVAL_ROLES in visit-request/routes.ts). A plain employee may
// only action their own hosted requests.
const ELEVATED_APPROVAL_ROLES = ["protocol_officer", "security_admin", "tenant_admin", "super_admin"];

export default async function HostPortalPage() {
  const [pending, approved, locations] = await Promise.all([
    getVisitRequests("pending_approval"),
    getVisitRequests("approved"),
    getVisitorLocations(),
  ]);

  const me = getSessionUserId();
  const roles = getSessionRoles();
  const elevated = hasAnyRole(roles, ELEVATED_APPROVAL_ROLES);

  // GAP-VISITOR-HOST-03: scope "Expected today" to the signed-in host (unless
  // an elevated role, which legitimately sees all). The list endpoint is not
  // host-scoped server-side, so filter web-side by hostEmployeeId.
  const expectedToday = approved.data.filter(
    (r) => isToday(r.scheduledAt) && (elevated || !me || r.hostEmployeeId === me),
  );

  // GAP-VISITOR-HOST-04: resolve location names for display.
  const locationNames: Record<string, string> = {};
  for (const l of locations.data) locationNames[l.id] = l.name;

  const source =
    pending.source === "error" || approved.source === "error" ? "error" : "api";

  return (
    <>
      <PageHeader
        title="Host Portal"
        subtitle="Approve or reject the visitors requesting to see you, and review today's expected arrivals."
        back="/visitor"
        backLabel="Visitor"
      />
      {source === "error" && (
        <RefreshErrorState
          error={{
            what: "We couldn't load some of your visitor data.",
            next: "Figures may be incomplete. Try again.",
            actions: ["retry"],
          }}
        />
      )}
      <HostPortal
        pending={pending.data}
        pendingSource={pending.source}
        expectedToday={expectedToday}
        expectedTodaySource={approved.source}
        currentHostId={me}
        canApproveAny={elevated}
        locationNames={locationNames}
      />
    </>
  );
}

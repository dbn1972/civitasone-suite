/**
 * GAP-WORKS-CONTRACTORS-NEW-02: the /works/contractors/new form previously had
 * NO web role gate — any signed-in role could open it (the backend POST
 * already 403s a non-write role, but the user saw a full form that was
 * guaranteed to fail on submit). This server-component layout gates the route
 * on the same write-role set works-service enforces, redirecting unauthorised
 * users to the register (defence-in-depth; the service stays the authority).
 */
import { requireAnyRole } from "@/lib/auth/roleGuard";
import { CONTRACTOR_WRITE_ROLES } from "@/lib/works/roles";

export default function NewContractorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  requireAnyRole([...CONTRACTOR_WRITE_ROLES], "/works/contractors");
  return <>{children}</>;
}

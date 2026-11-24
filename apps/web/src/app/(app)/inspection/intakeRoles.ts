import { getSessionRoles } from "@/lib/auth/roleGuard";

/** Session roles for deciding which intake actions to OFFER; [] outside a request. The service enforces every call. */
export function sessionRolesOrEmpty(): string[] {
  try {
    return getSessionRoles();
  } catch {
    return [];
  }
}

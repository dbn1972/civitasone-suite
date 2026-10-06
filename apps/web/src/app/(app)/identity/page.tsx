import { ModuleHub } from "../../_components/ModuleHub";
import { IDENTITY_ADMIN_ROLES } from "@/lib/auth/identityRoles";

export default function Page() {
  return (
    <ModuleHub
      title="Identity"
      // GAP-IDENTITY-HOME-04 / LOADING: no internal service name in user copy.
      description="Users, sessions, API keys, emergency access and passkeys for this office."
      help="identity"
      links={[
        // GAP-IDENTITY-USERS-02: point Users at the canonical tenant-admin
        // directory (invite / lock / role change, email + role columns),
        // not the read-only identity stub. GAP-IDENTITY-HOME-01: explicit icon.
        { href: "/tenant-admin/users", label: "Users", note: "User directory with roles and MFA status", icon: "👤" },
        { href: "/tenant-admin/roles", label: "Roles", note: "Role assignments and permissions", icon: "🧩" },
        { href: "/identity/sessions", label: "Sessions", note: "Active and recent sign-ins", icon: "🖥️" },
        // GAP-IDENTITY-API-KEYS-02: canonical keys page with create / rotate /
        // revoke, scopes, expiry and last-used.
        { href: "/tenant-admin/api-keys", label: "API keys", note: "Service and integration keys", icon: "🔑" },
        { href: "/identity/breakglass", label: "Break-glass", note: "Emergency access requests", icon: "🚨" },
        { href: "/identity/webauthn", label: "WebAuthn", note: "Your registered passkeys", icon: "🔐" },
        // GAP-IDENTITY-HOME-02 / HOME-03: MFA & SSO are managed in Tenant Admin.
        // Reword away from the bare "(admin)" suffix and hide the tiles for
        // sessions that cannot reach the tenant-admin surface anyway.
        {
          href: "/tenant-admin/mfa",
          label: "MFA policy",
          note: "Managed in Tenant Admin",
          icon: "📱",
          roles: IDENTITY_ADMIN_ROLES,
        },
        {
          href: "/tenant-admin/sso",
          label: "SSO / IdP",
          note: "Managed in Tenant Admin",
          icon: "🪪",
          roles: IDENTITY_ADMIN_ROLES,
        },
      ]}
    />
  );
}

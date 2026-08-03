import { ModuleHub } from "../../_components/ModuleHub";

export default function Page() {
  return (
    <ModuleHub
      title="Identity"
      description="Users, sessions, API keys, break-glass and WebAuthn credentials from identity-service."
      help="identity"
      links={[
        { href: "/identity/users", label: "Users", note: "Tenant user directory" },
        { href: "/identity/sessions", label: "Sessions", note: "Active and recent sessions" },
        { href: "/identity/api-keys", label: "API keys", note: "Service and integration API keys" },
        { href: "/identity/breakglass", label: "Break-glass", note: "Emergency access requests" },
        { href: "/identity/webauthn", label: "WebAuthn", note: "Passkey / WebAuthn credentials" },
        { href: "/tenant-admin/mfa", label: "MFA (admin)", note: "MFA policy in tenant admin" },
        { href: "/tenant-admin/sso", label: "SSO (admin)", note: "SSO / IdP configuration" },
      ]}
    />
  );
}

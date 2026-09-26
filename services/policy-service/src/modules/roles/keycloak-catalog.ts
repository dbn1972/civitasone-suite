/**
 * Keycloak realm role catalog — the 7 role names the real Keycloak realm
 * actually issues (verified against the realm export, not inferred from
 * route guards): super_admin, tenant_admin, dept_head, officer, auditor,
 * citizen, service_account.
 *
 * Phase 1b of the RBAC remediation: `roles.roles` / `roles.permissions` had
 * no seed for ANY of these 7 names, so the DB-backed evaluator in
 * ../evaluate/{domain,repo}.ts — which resolves a caller's permissions from a
 * `roles.roles` row whose `name` matches a JWT role — was structurally
 * unable to grant a real Keycloak token anything (super_admin excepted; see
 * below). This catalog + keycloak-provision.ts exist to make that plumbing
 * actually work end-to-end, mirroring the municipal-catalog.ts /
 * municipal-provision.ts pattern one module over.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * IMPORTANT — READ BEFORE EXTENDING THIS FILE
 *
 * The permission sets below are a DELIBERATELY CONSERVATIVE STARTING POINT,
 * not a considered, final policy decision. Beyond super_admin (see its own
 * note) and tenant_admin (grounded directly in this service's existing
 * `requireRole(ctx, ADMIN)` guards — see roles/routes.ts, bindings/routes.ts,
 * abac/routes.ts, policies/routes.ts, all of which already treat
 * "tenant_admin" as a full policy-service administrator today), the exact
 * permission scope for dept_head / officer / auditor / citizen /
 * service_account across this platform's 66 services is a genuinely open
 * product/policy question that this seed does NOT attempt to resolve. Every
 * non-tenant_admin, non-super_admin entry here is scoped ONLY to
 * policy-service's own admin surface (roles/bindings/abac visibility) —
 * never to any of the other 65 services — and is intentionally minimal.
 *
 * Do NOT treat this as a comprehensive RBAC matrix. When a real feature
 * needs one of these 5 roles to do something this catalog doesn't grant,
 * the correct fix is almost always a scoped grant via the existing
 * `bindings.bindings` per-user mechanism (see ../bindings), or a deliberate,
 * reviewed extension of that ONE role's entry here — not a blanket
 * broadening of this starter set.
 * ─────────────────────────────────────────────────────────────────────────
 */
export type KeycloakRoleStub = {
  name: string;
  description: string;
  /**
   * Permission keys for policy-service's evaluate endpoint, `resource.action`
   * (resource itself may contain dots — see parsePermissionKey in
   * ../evaluate/domain.ts). An empty array is deliberate for a role, not an
   * oversight — see the per-role comments below.
   */
  permissions: string[];
};

const POLICY_ROLES_READ = "policy.roles.read";
const POLICY_ROLES_WRITE = "policy.roles.write";
const POLICY_BINDINGS_READ = "policy.bindings.read";
const POLICY_BINDINGS_WRITE = "policy.bindings.write";
const POLICY_ABAC_RULES_READ = "policy.abac_rules.read";
const POLICY_ABAC_RULES_WRITE = "policy.abac_rules.write";

export const KEYCLOAK_REALM_ROLE_CATALOG: KeycloakRoleStub[] = [
  {
    name: "super_admin",
    description: "Platform super administrator — unrestricted access.",
    // No permission rows: evaluateDecision() in ../evaluate/domain.ts already
    // grants super_admin an unconditional allow before it ever looks at
    // `granted` rows. Seeding fabricated "everything" rows here would be
    // both redundant (the bypass already covers it) and misleading (this
    // schema has no wildcard concept — any rows we invented would only ever
    // describe a fixed, incomplete slice of "everything", not the real
    // unconditional grant the evaluator actually gives this role). The role
    // row itself is still seeded so super_admin exists for listing/binding
    // referential purposes.
    permissions: [],
  },
  {
    name: "tenant_admin",
    description: "Tenant administrator — broad administrative access within their own tenant.",
    // Grounded directly in this codebase today: `requireRole(ctx, ADMIN)`
    // (ADMIN = ["platform_admin","super_admin","tenant_admin"]) already
    // gates every admin route in roles/, bindings/, abac/, and policies/ for
    // tenant_admin. This just encodes that SAME, already-real admin surface
    // into the DB-permission-table form the evaluate endpoint reads — it
    // does not grant tenant_admin anything new, and does not reach into any
    // of the other 65 services. "Broad" here means broad within
    // policy-service's own domain, not platform-wide.
    permissions: [
      POLICY_ROLES_READ,
      POLICY_ROLES_WRITE,
      POLICY_BINDINGS_READ,
      POLICY_BINDINGS_WRITE,
      POLICY_ABAC_RULES_READ,
      POLICY_ABAC_RULES_WRITE,
    ],
  },
  {
    name: "auditor",
    description: "Cross-cutting read-only oversight role.",
    // "Auditor" is the one of the five open-policy roles whose minimal scope
    // is genuinely unambiguous: read-only visibility into policy
    // configuration, nothing else. Still scoped to policy-service's own
    // admin surface only.
    permissions: [POLICY_ROLES_READ, POLICY_BINDINGS_READ],
  },
  {
    name: "dept_head",
    description: "Department head — narrow, read-only starting point pending real scope decisions.",
    // Deliberately minimal: nothing in this codebase today grounds a wider
    // grant for dept_head specifically. Visibility into the role catalog
    // only (e.g. to see what roles exist), no write access.
    permissions: [POLICY_ROLES_READ],
  },
  {
    name: "officer",
    description: "Front-line officer — narrow, read-only starting point pending real scope decisions.",
    // Same narrow tier as dept_head — nothing in the codebase distinguishes
    // an officer's policy-service access from a dept_head's today, so this
    // deliberately does NOT invent a hierarchy between them.
    permissions: [POLICY_ROLES_READ],
  },
  {
    name: "citizen",
    description: "External citizen/constituent — no policy-service administrative access.",
    // Citizens are external end-users of citizen-facing services, never
    // administrators of policy-service's own roles/bindings/abac
    // configuration. Zero permissions is the correct, not merely cautious,
    // default here.
    permissions: [],
  },
  {
    name: "service_account",
    description: "Generic machine-to-machine identity — no blanket administrative access.",
    // A "service account" covers many different actual integrations with
    // very different real needs; there is no single unambiguous permission
    // set a GENERIC service_account role should hold. Specific integrations
    // that need elevated, scoped access should get it via a targeted
    // `bindings.bindings` grant for that specific identity, not through this
    // shared role.
    permissions: [],
  },
];

/** Flat list of the 7 real Keycloak realm role names. */
export function listKeycloakRoleNames(): string[] {
  return KEYCLOAK_REALM_ROLE_CATALOG.map((r) => r.name).sort();
}

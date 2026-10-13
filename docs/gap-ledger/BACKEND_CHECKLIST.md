# Backend verification checklist

Every item below is a claim the web UI depends on that could not be checked because the service code was not in the snapshot (only `hrms-service` was). For each: open the route, confirm, add the test. `defect`/`partly` verdicts were found in code and need action.

441 items across 62 services.

| Service | Items |
|---|---|
| admin-service | 47 |
| procurement-service | 38 |
| works-service | 36 |
| asset-service | 22 |
| payroll-service | 20 |
| crm-service | 16 |
| tenant-service | 13 |
| audit-service | 13 |
| inventory-service | 13 |
| knowledge-service | 12 |
| billing-service | 11 |
| citizen-service | 11 |
| finance-service | 11 |
| identity-service | 10 |
| hrms-service | 10 |
| legal-service | 10 |
| revenue-service | 10 |
| location-service | 9 |
| cdp-service | 8 |
| notification-service | 8 |
| stock-service | 8 |
| contract-service | 7 |
| policy-service | 6 |
| workflow-service | 6 |
| project-service | 6 |
| theme-service | 6 |
| telephony-service | 6 |
| meeting-service | 5 |
| report-service | 5 |
| visitor-service | 5 |
| unknown | 4 |
| estab-service | 4 |
| journey-service | 4 |
| recommendation-service | 4 |
| field-service | 3 |
| admin-service (or a future bulk-scan/jobs service) | 2 |
| ml-service | 2 |
| document-service | 2 |
| loyalty-service | 2 |
| metadata-service | 2 |
| admin-service / identity-service | 2 |
| identity-service (and admin-service) | 2 |
| gateway-service | 1 |
| ai-agent-service | 1 |
| catalogue-service | 1 |
| web (no backend) | 1 |
| (none) | 1 |
| court-service | 1 |
| crm-service (web-only finding) | 1 |
| citizen-service (catalogue) | 1 |
| citizen-service, finance-service | 1 |
| domain-service | 1 |
| assets-service | 1 |
| grants-service | 1 |
| helpdesk-service | 1 |
| apps/web | 1 |
| apps/web (install-service shape unverified) | 1 |
| web gateway (next.config redirects) | 1 |
| service worker / sync layer (no backend service) | 1 |
| plugin-service | 1 |
| analytics-service | 1 |
| install-service | 1 |

## admin-service (47)

- [ ] **GAP-ADMIN-API-MONITORING-01** (high, unverified-service-absent) `GET /api/v1/admin/api-monitoring`
  - Q: Does admin-service return 403 on GET /api/v1/admin/api-monitoring for any caller lacking super_admin/platform_admin (and scope tenant data to the caller's tenant), regardless of the web page having no gate?
  - Verify: In admin-service repo open the route file registering GET /api/v1/admin/api-monitoring and confirm a preHandler/requireRole guard; then curl it with a JWT of a plain tenant user (e.g. employee) and expect 403, with a super_admin JWT expect 200.
  - Test: Given a JWT with role=employee, when GET/PATCH GET /api/v1/admin/api-monitoring, then 403 and no body data; given super_admin, then 200.
  - If wrong: Any signed-in user reads or changes platform-operator data (privilege escalation / cross-tenant exposure).
- [ ] **GAP-ADMIN-BULK-SCAN-01** (high, unverified-service-absent) `none (page is a placeholder; no endpoint called)`
  - Q: Once a bulk-scan endpoint exists in admin-service, is it restricted to super_admin/platform_admin?
  - Verify: Confirm no bulk-scan route exists in admin-service routes; when added, verify the guard and curl as employee expecting 403.
  - Test: Given employee JWT, when calling the future bulk-scan endpoint, then 403.
  - If wrong: Low today (no data); any future endpoint would be open to every user.
- [ ] **GAP-ADMIN-CONFIG-02** (high, unverified-service-absent) `GET/PATCH /api/v1/admin/platform-config`
  - Q: Does admin-service return 403 on GET/PATCH /api/v1/admin/platform-config for any caller lacking super_admin/platform_admin (and scope tenant data to the caller's tenant), regardless of the web page having no gate?
  - Verify: In admin-service repo open the route file registering GET/PATCH /api/v1/admin/platform-config and confirm a preHandler/requireRole guard; then curl it with a JWT of a plain tenant user (e.g. employee) and expect 403, with a super_admin JWT expect 200.
  - Test: Given a JWT with role=employee, when GET/PATCH GET/PATCH /api/v1/admin/platform-config, then 403 and no body data; given super_admin, then 200.
  - If wrong: Any signed-in user reads or changes platform-operator data (privilege escalation / cross-tenant exposure).
- [ ] **GAP-ADMIN-CONFIG-03** (high, unverified-service-absent) `PATCH /api/v1/admin/platform-config`
  - Q: Does PATCH platform-config validate bounds (max login attempts, session timeout), emit an audit event with actor and before/after values, and require super_admin?
  - Verify: Open the platform-config handler: check zod bounds and @civitasone/events emit; PATCH with maxLoginAttempts=999 expecting 422 and then check the audit store for an entry on a valid change.
  - Test: Given super_admin, when PATCH selfRegistration=true, then 200 and an audit event {actor, before, after} is emitted; when maxLoginAttempts=999, then 422.
  - If wrong: Silent weakening of platform security with no trail (CLAUDE.md rule 8 violation).
- [ ] **GAP-ADMIN-DISCOVERY-01** (high, unverified-service-absent) `none (page is a placeholder; no endpoint called)`
  - Q: Once a discovery endpoint exists in admin-service, is it restricted to super_admin/platform_admin?
  - Verify: Confirm no discovery route exists in admin-service; when added, verify the guard and curl as employee expecting 403.
  - Test: Given employee JWT, when calling the future discovery endpoint, then 403.
  - If wrong: Low today (no data); any future endpoint would be open to every user.
- [ ] **GAP-ADMIN-EDITIONS-01** (high, unverified-service-absent) `GET /api/v1/admin/editions`
  - Q: Does admin-service return 403 on GET /api/v1/admin/editions for any caller lacking super_admin/platform_admin (and scope tenant data to the caller's tenant), regardless of the web page having no gate?
  - Verify: In admin-service repo open the route file registering GET /api/v1/admin/editions and confirm a preHandler/requireRole guard; then curl it with a JWT of a plain tenant user (e.g. employee) and expect 403, with a super_admin JWT expect 200.
  - Test: Given a JWT with role=employee, when GET/PATCH GET /api/v1/admin/editions, then 403 and no body data; given super_admin, then 200.
  - If wrong: Any signed-in user reads or changes platform-operator data (privilege escalation / cross-tenant exposure).
- [ ] **GAP-ADMIN-ENTITLEMENTS-01** (high, unverified-service-absent) `GET /api/v1/admin/entitlements`
  - Q: Does admin-service return 403 on GET /api/v1/admin/entitlements for any caller lacking super_admin/platform_admin (and scope tenant data to the caller's tenant), regardless of the web page having no gate?
  - Verify: In admin-service repo open the route file registering GET /api/v1/admin/entitlements and confirm a preHandler/requireRole guard; then curl it with a JWT of a plain tenant user (e.g. employee) and expect 403, with a super_admin JWT expect 200.
  - Test: Given a JWT with role=employee, when GET/PATCH GET /api/v1/admin/entitlements, then 403 and no body data; given super_admin, then 200.
  - If wrong: Any signed-in user reads or changes platform-operator data (privilege escalation / cross-tenant exposure).
- [ ] **GAP-ADMIN-FEATURE-FLAGS-02** (high, unverified-service-absent) `GET/POST/PATCH /api/v1/admin/feature-flags/manage (via /api/proxy)`
  - Q: Does admin-service return 403 on GET/POST/PATCH /api/v1/admin/feature-flags/manage (via /api/proxy) for any caller lacking super_admin/platform_admin (and scope tenant data to the caller's tenant), regardless of the web page having no gate?
  - Verify: In admin-service repo open the route file registering GET/POST/PATCH /api/v1/admin/feature-flags/manage (via /api/proxy) and confirm a preHandler/requireRole guard; then curl it with a JWT of a plain tenant user (e.g. employee) and expect 403, with a super_admin JWT expect 200.
  - Test: Given a JWT with role=employee, when GET/PATCH GET/POST/PATCH /api/v1/admin/feature-flags/manage (via /api/proxy), then 403 and no body data; given super_admin, then 200.
  - If wrong: Any signed-in user reads or changes platform-operator data (privilege escalation / cross-tenant exposure).
- [ ] **GAP-ADMIN-GATEWAY-CONFIG-02** (high, unverified-service-absent) `PATCH /api/v1/admin/platform-config/gateway`
  - Q: Does the gateway-config PATCH enforce safe bounds (body limit, rate limits, jwtEdgeMode enum), emit an audit event with before/after, and support rollback?
  - Verify: Open the platform-config/gateway handler; PATCH jwtEdgeMode=off, bodyLimitMb=500, rateLimit=1e7 expecting 422 (or explicit super_admin-only allowance); check audit emission.
  - Test: Given super_admin, when PATCH jwtEdgeMode=off, then audit event with actor+diff is emitted; when rateLimit exceeds max, then 422.
  - If wrong: One click can disable edge JWT verification platform-wide with no trail.
- [ ] **GAP-ADMIN-GATEWAY-CONFIG-03** (high, unverified-service-absent) `GET/PATCH /api/v1/admin/platform-config/gateway`
  - Q: Does admin-service return 403 on GET/PATCH /api/v1/admin/platform-config/gateway for any caller lacking super_admin/platform_admin (and scope tenant data to the caller's tenant), regardless of the web page having no gate?
  - Verify: In admin-service repo open the route file registering GET/PATCH /api/v1/admin/platform-config/gateway and confirm a preHandler/requireRole guard; then curl it with a JWT of a plain tenant user (e.g. employee) and expect 403, with a super_admin JWT expect 200.
  - Test: Given a JWT with role=employee, when GET/PATCH GET/PATCH /api/v1/admin/platform-config/gateway, then 403 and no body data; given super_admin, then 200.
  - If wrong: Any signed-in user reads or changes platform-operator data (privilege escalation / cross-tenant exposure).
- [ ] **GAP-ADMIN-GATEWAYS-01** (high, unverified-service-absent) `GET /api/v1/admin/gateways`
  - Q: Does admin-service return 403 on GET /api/v1/admin/gateways for any caller lacking super_admin/platform_admin (and scope tenant data to the caller's tenant), regardless of the web page having no gate?
  - Verify: In admin-service repo open the route file registering GET /api/v1/admin/gateways and confirm a preHandler/requireRole guard; then curl it with a JWT of a plain tenant user (e.g. employee) and expect 403, with a super_admin JWT expect 200.
  - Test: Given a JWT with role=employee, when GET/PATCH GET /api/v1/admin/gateways, then 403 and no body data; given super_admin, then 200.
  - If wrong: Any signed-in user reads or changes platform-operator data (privilege escalation / cross-tenant exposure).
- [ ] **GAP-ADMIN-HOME-01** (high, unverified-service-absent) `GET /api/v1/admin/sa-dashboard, /api/v1/admin/operations (hub data) and linked list endpoints`
  - Q: Does admin-service return 403 on GET /api/v1/admin/sa-dashboard, /api/v1/admin/operations (hub data) and linked list endpoints for any caller lacking super_admin/platform_admin (and scope tenant data to the caller's tenant), regardless of the web page having no gate?
  - Verify: In admin-service repo open the route file registering GET /api/v1/admin/sa-dashboard, /api/v1/admin/operations (hub data) and linked list endpoints and confirm a preHandler/requireRole guard; then curl it with a JWT of a plain tenant user (e.g. employee) and expect 403, with a super_admin JWT expect 200.
  - Test: Given a JWT with role=employee, when GET/PATCH GET /api/v1/admin/sa-dashboard, /api/v1/admin/operations (hub data) and linked list endpoints, then 403 and no body data; given super_admin, then 200.
  - If wrong: Any signed-in user reads or changes platform-operator data (privilege escalation / cross-tenant exposure).
- [ ] **GAP-ADMIN-INTEGRATIONS-01** (high, unverified-service-absent) `GET/POST/PATCH /api/v1/admin/integrations (via /api/proxy); GET /api/v1/admin/api-keys`
  - Q: Does admin/integrations reject non-admin callers, enforce maker-checker for credential writes, mask secrets on read, and audit every write?
  - Verify: Open the integrations route file: check role guard, maker-checker (creator != approver) and response redaction; POST a credential as tenant user expecting 403, GET as super_admin and confirm secrets are masked.
  - Test: Given a pending credential change by user A, when A approves it, then 403; when B approves, then 200 and audit event; GET never returns plaintext secret.
  - If wrong: Third-party credentials (SMTP, PFMS, SFTP key) changed or leaked by unauthorised or unreviewed users.
- [ ] **GAP-ADMIN-INVOICES-01** (high, unverified-service-absent) `GET /api/v1/billing/invoices`
  - Q: Does admin-service return 403 on GET /api/v1/billing/invoices for any caller lacking super_admin/platform_admin (and scope tenant data to the caller's tenant), regardless of the web page having no gate?
  - Verify: In admin-service repo open the route file registering GET /api/v1/billing/invoices and confirm a preHandler/requireRole guard; then curl it with a JWT of a plain tenant user (e.g. employee) and expect 403, with a super_admin JWT expect 200.
  - Test: Given a JWT with role=employee, when GET/PATCH GET /api/v1/billing/invoices, then 403 and no body data; given super_admin, then 200.
  - If wrong: Any signed-in user reads or changes platform-operator data (privilege escalation / cross-tenant exposure).
- [ ] **GAP-ADMIN-METERING-01** (high, unverified-service-absent) `GET /api/v1/billing/metering`
  - Q: Does admin-service return 403 on GET /api/v1/billing/metering for any caller lacking super_admin/platform_admin (and scope tenant data to the caller's tenant), regardless of the web page having no gate?
  - Verify: In admin-service repo open the route file registering GET /api/v1/billing/metering and confirm a preHandler/requireRole guard; then curl it with a JWT of a plain tenant user (e.g. employee) and expect 403, with a super_admin JWT expect 200.
  - Test: Given a JWT with role=employee, when GET/PATCH GET /api/v1/billing/metering, then 403 and no body data; given super_admin, then 200.
  - If wrong: Any signed-in user reads or changes platform-operator data (privilege escalation / cross-tenant exposure).
- [ ] **GAP-ADMIN-ONBOARDING-01** (high, unverified-service-absent) `GET /api/v1/admin/onboarding`
  - Q: Does admin-service return 403 on GET /api/v1/admin/onboarding for any caller lacking super_admin/platform_admin (and scope tenant data to the caller's tenant), regardless of the web page having no gate?
  - Verify: In admin-service repo open the route file registering GET /api/v1/admin/onboarding and confirm a preHandler/requireRole guard; then curl it with a JWT of a plain tenant user (e.g. employee) and expect 403, with a super_admin JWT expect 200.
  - Test: Given a JWT with role=employee, when GET/PATCH GET /api/v1/admin/onboarding, then 403 and no body data; given super_admin, then 200.
  - If wrong: Any signed-in user reads or changes platform-operator data (privilege escalation / cross-tenant exposure).
- [ ] **GAP-ADMIN-OPERATORS-01** (high, unverified-service-absent) `GET /api/v1/admin/operators`
  - Q: Does admin-service return 403 on GET /api/v1/admin/operators for any caller lacking super_admin/platform_admin (and scope tenant data to the caller's tenant), regardless of the web page having no gate?
  - Verify: In admin-service repo open the route file registering GET /api/v1/admin/operators and confirm a preHandler/requireRole guard; then curl it with a JWT of a plain tenant user (e.g. employee) and expect 403, with a super_admin JWT expect 200.
  - Test: Given a JWT with role=employee, when GET/PATCH GET /api/v1/admin/operators, then 403 and no body data; given super_admin, then 200.
  - If wrong: Any signed-in user reads or changes platform-operator data (privilege escalation / cross-tenant exposure).
- [ ] **GAP-ADMIN-ROLES-01** (high, unverified-service-absent) `GET/PATCH /api/v1/admin/roles, /api/v1/admin/roles/{id}, /api/v1/admin/roles/{id}/permissions, GET /api/v1/admin/permissions`
  - Q: Does admin-service return 403 on GET/PATCH /api/v1/admin/roles, /api/v1/admin/roles/{id}, /api/v1/admin/roles/{id}/permissions, GET /api/v1/admin/permissions for any caller lacking super_admin/platform_admin (and scope tenant data to the caller's tenant), regardless of the web page having no gate?
  - Verify: In admin-service repo open the route file registering GET/PATCH /api/v1/admin/roles, /api/v1/admin/roles/{id}, /api/v1/admin/roles/{id}/permissions, GET /api/v1/admin/permissions and confirm a preHandler/requireRole guard; then curl it with a JWT of a plain tenant user (e.g. employee) and expect 403, with a super_admin JWT expect 200.
  - Test: Given a JWT with role=employee, when GET/PATCH GET/PATCH /api/v1/admin/roles, /api/v1/admin/roles/{id}, /api/v1/admin/roles/{id}/permissions, GET /api/v1/admin/permissions, then 403 and no body data; given super_admin, then 200.
  - If wrong: Any signed-in user reads or changes platform-operator data (privilege escalation / cross-tenant exposure).
- [ ] **GAP-ADMIN-ROLES-02** (high, unverified-service-absent) `PUT/PATCH /api/v1/admin/roles/{id}/permissions`
  - Q: Does the permissions endpoint diff old vs new sets, emit an audit event listing granted/revoked keys with actor, and block editing system roles or escalating beyond the caller's own permissions?
  - Verify: Open the role-permissions handler: check audit emit payload and isSystem guard; PUT as tenant admin adding super_admin-only keys expecting 403.
  - Test: Given role R with keys {a}, when PUT {a,b}, then audit event has added=[b], removed=[]; when caller lacks b, then 403.
  - If wrong: Unaudited privilege grants; permission escalation.
- [ ] **GAP-ADMIN-SCHEDULED-JOBS-02** (high, unverified-service-absent) `GET/POST/PATCH /api/v1/admin/scheduled-jobs, GET .../{id}/history`
  - Q: Does scheduled-jobs POST restrict callers to super_admin/platform_admin, validate targetService/command against an allow-list and payload schema, and audit creation?
  - Verify: In admin-service repo open the route file registering GET/POST/PATCH /api/v1/admin/scheduled-jobs, GET .../{id}/history and confirm a preHandler/requireRole guard; then curl it with a JWT of a plain tenant user (e.g. employee) and expect 403, with a super_admin JWT expect 200.
  - Test: Given employee JWT, when POST scheduled-jobs, then 403; given super_admin with targetCommand not in allow-list, then 422; valid job emits audit event.
  - If wrong: Arbitrary command execution against finance/hrms/audit services by any user.
- [ ] **GAP-ADMIN-TECH-ADMIN-01** (high, unverified-service-absent) `GET /api/v1/admin/health/services`
  - Q: Does admin-service return 403 on GET /api/v1/admin/health/services for any caller lacking super_admin/platform_admin (and scope tenant data to the caller's tenant), regardless of the web page having no gate?
  - Verify: In admin-service repo open the route file registering GET /api/v1/admin/health/services and confirm a preHandler/requireRole guard; then curl it with a JWT of a plain tenant user (e.g. employee) and expect 403, with a super_admin JWT expect 200.
  - Test: Given a JWT with role=employee, when GET/PATCH GET /api/v1/admin/health/services, then 403 and no body data; given super_admin, then 200.
  - If wrong: Any signed-in user reads or changes platform-operator data (privilege escalation / cross-tenant exposure).
- [ ] **GAP-ADMIN-TENANTS-01** (high, unverified-service-absent) `GET /api/v1/tenants`
  - Q: Does admin-service return 403 on GET /api/v1/tenants for any caller lacking super_admin/platform_admin (and scope tenant data to the caller's tenant), regardless of the web page having no gate?
  - Verify: In admin-service repo open the route file registering GET /api/v1/tenants and confirm a preHandler/requireRole guard; then curl it with a JWT of a plain tenant user (e.g. employee) and expect 403, with a super_admin JWT expect 200.
  - Test: Given a JWT with role=employee, when GET/PATCH GET /api/v1/tenants, then 403 and no body data; given super_admin, then 200.
  - If wrong: Any signed-in user reads or changes platform-operator data (privilege escalation / cross-tenant exposure).
- [ ] **GAP-ADMIN-TENANTS-DETAIL-02** (high, unverified-service-absent) `GET /api/v1/admin/tenants/{id}, GET /api/v1/admin/tenants/{id}/config, tenant modules usage`
  - Q: Does GET /admin/tenants/{id} return 403/404 unless the caller is platform staff or a member of that tenant?
  - Verify: In admin-service repo open the route file registering GET /api/v1/admin/tenants/{id}, GET /api/v1/admin/tenants/{id}/config, tenant modules usage and confirm a preHandler/requireRole guard; then curl it with a JWT of a plain tenant user (e.g. employee) and expect 403, with a super_admin JWT expect 200.
  - Test: Given tenant-A user, when GET /admin/tenants/{tenant-B id}, then 403 or 404.
  - If wrong: Cross-tenant data disclosure by ID guessing (IDOR).
- [ ] **GAP-ADMIN-USERS-02** (high, unverified-service-absent) `PUT/PATCH /api/v1/admin/user-roles/{userId}; GET /api/v1/admin/roles`
  - Q: Does user-roles assignment refuse system roles (super_admin/platform_admin) unless the caller is platform staff, and does GET roles hide them from tenant admins?
  - Verify: Open the user-roles handler and check isSystem/hierarchy guard; as tenant_admin PUT roles=[super_admin] for a user expecting 403.
  - Test: Given tenant_admin, when assigning super_admin to user X, then 403 and no change; audit event on successful assignments.
  - If wrong: Tenant admin can mint platform super-admins (full privilege escalation).
- [ ] **GAP-CHANGE-HOME-01** (high, unverified-service-absent) `['POST /v1/admin/change/requests', 'POST /v1/admin/change/requests/:id/*']`
  - Q: Which roles may create and transition change requests, and is 403 returned with a stable error code?
  - Verify: Open route role guards in admin-service change module; curl POST requests with a plain employee token.
  - Test: Given employee without change.raise, when POST requests, then 403 FORBIDDEN and no row created.
  - If wrong: Unauthorised change requests reach CAB, or users lose typed input to a late 403; medium.
- [ ] **GAP-PLATFORM-ADMIN-ORG-CONFIG-02** (high, unverified-service-absent) `['GET/PUT /api/v1/admin/org-hierarchy-levels']`
  - Q: PUT org-hierarchy-levels must require tenant_admin/platform_admin, be tenant-scoped, validate order/uniqueness, and emit audit.
  - Verify: Open admin-service org-hierarchy-levels route; curl PUT as employee expecting 403; as admin with duplicate level keys expecting 422.
  - Test: Given employee JWT, when PUT levels, then 403 and unchanged; given admin, audit event emitted.
  - If wrong: Any user can reshape tenant org taxonomy.
- [ ] **GAP-PLATFORM-ADMIN-TENANT-CONFIG-02** (high, unverified-service-absent) `['(none found: TenantConfigCard.tsx uses DEFAULT_CONFIG, no v1/ call)', 'tenant config endpoint TBD']`
  - Q: Whichever endpoint supplies dbSchema and keycloakRealm must return them only to platform_admin/super_admin.
  - Verify: Find the tenant-config route in admin-service (grep tenant-config/tenants). If none, confirm the card is static (TenantConfigCard.tsx:22-24). curl as employee expecting the two fields absent or 403.
  - Test: Given tenant_admin JWT, when GET tenant config, then response omits dbSchema and keycloakRealm.
  - If wrong: Infrastructure identifiers disclosed to all users.
- [ ] **GAP-ADMIN-SETTINGS-06** (medium, unverified-service-absent) `PATCH /api/v1/admin/settings/{general,email,security,integrations}; POST /api/v1/admin/settings/email/test`
  - Q: Do admin settings endpoints require tenant_admin+, audit each mutation, mask SMTP password on read, and does email/test use stored credentials (or accept an optional body)?
  - Verify: In admin-service repo open the route file registering PATCH /api/v1/admin/settings/{general,email,security,integrations}; POST /api/v1/admin/settings/email/test and confirm a preHandler/requireRole guard; then curl it with a JWT of a plain tenant user (e.g. employee) and expect 403, with a super_admin JWT expect 200.
  - Test: Given employee JWT, when PATCH settings/email, then 403; given tenant_admin, then 200 + audit event; GET never returns plaintext password.
  - If wrong: SMTP/MFA policy changed by unauthorised users, or credentials leaked.
- [ ] **GAP-ADMIN-TECH-ADMIN-03** (medium, unverified-service-absent) `GET /api/v1/admin/health/services`
  - Q: What is the closed set of values for each service's status field (running/stopped vs PM2 online/errored/degraded) in health/services?
  - Verify: Open the health/services handler and its status type/enum; curl it and list distinct status values.
  - Test: Given services with statuses online, errored, stopped, when GET health/services, then status values are within the documented enum.
  - If wrong: Degraded tile miscounts, hiding real outages or raising false alarms.
- [ ] **GAP-TENANT-ADMIN-COMPLIANCE-02** (medium, unverified-service-absent) `['GET /api/v1/admin/compliance (loaders.ts getComplianceOverview ~L4743)']`
  - Q: Does each compliance score in the response carry method, scope and asOf (computed-at) fields plus per-check evidence reference?
  - Verify: Open admin-service compliance route/handler and its zod response schema; curl GET /v1/admin/compliance as tenant_admin and inspect for score, method, scope, asOf, checks[].evidenceUrl.
  - Test: Given a tenant with DPDP checks, when GET /v1/admin/compliance, then each score has method, scope, asOf (UTC ISO) and every check has evidenceRef or explicit null.
  - If wrong: Board-level DPDP score without provenance is not defensible in audit; misreported compliance.
- [ ] **GAP-TENANT-ADMIN-OPERATIONS-04** (medium, unverified-service-absent) `['GET /api/v1/admin/operations (loaders.ts:4292)']`
  - Q: Is log excerpt redaction (emails, phones, Aadhaar, PAN, tokens) applied in admin-service before the response, and is the endpoint limited to platform_admin/super_admin?
  - Verify: Open admin-service operations handler and redaction util; seed a log line with email/Aadhaar/JWT and curl as platform_admin and tenant_admin (expect 403).
  - Test: Given an error log containing 'user a@b.in aadhaar 1234 5678 9012 token eyJ...', when GET /v1/admin/operations, then excerpt contains masked values only.
  - If wrong: PII/secret leakage to admin browsers: DPDP breach, CERT-In reportable.
- [ ] **GAP-TENANT-ADMIN-PLATFORM-CONFIG-03** (medium, unverified-service-absent) `['GET /api/v1/admin/platform-config (page.tsx:25)']`
  - Q: Does admin-service strip credentials from redisUrl/dbHost/queue/bucket endpoints (userinfo, passwords, access keys) and limit the endpoint to platform_admin/super_admin?
  - Verify: Open platform-config handler; set REDIS_URL=redis://:secret@host:6379 and curl as platform_admin and tenant_admin (expect 403).
  - Test: Given redis URL with password, when GET, then response contains host:port only, no userinfo; tenant_admin gets 403.
  - If wrong: Credential disclosure to browser and logs; infrastructure compromise.
- [ ] **GAP-TENANT-ADMIN-SECURITY-03** (medium, unverified-service-absent) `['GET /api/v1/admin/security/overview (loaders.ts:4629)']`
  - Q: What is the complete enum of security event outcome values?
  - Verify: Open admin-service security event schema/enum; query events of each outcome.
  - Test: Given events with outcome success, failure, flagged, pending, challenged, when listed, then each value is in the documented enum.
  - If wrong: Pending/challenged events shown as failures, misleading incident triage.
- [ ] **GAP-TENANT-ADMIN-WEBHOOKS-05** (medium, unverified-service-absent) `['POST /api/v1/admin/webhooks (WebhooksClient.tsx:61)', 'GET /api/v1/admin/webhooks', 'POST /api/v1/admin/webhooks/:id/test']`
  - Q: Does the server reject non-https, private/loopback/link-local/metadata (SSRF) targets, empty events, and unknown event names, and re-check the resolved IP at delivery time?
  - Verify: Open admin-service webhooks create schema and delivery worker; POST url=http://169.254.169.254/, http://localhost, https://10.0.0.5 and events=[].
  - Test: Given url http://169.254.169.254/latest, when POST webhook or test, then 422 and no outbound request; events=[] gives 422; event names validated against server registry.
  - If wrong: SSRF into internal network/cloud metadata from tenant-controlled URL.
- [ ] **GAP-ADMIN-API-MONITORING-06** (low, unverified-service-absent) `GET /api/v1/admin/api-monitoring`
  - Q: Does each row carry errorRate with a defined unit (ratio 0-1 vs percent), p95 in ms, and a generatedAt/lastCheckedAt timestamp?
  - Verify: Open the admin-service api-monitoring handler/response schema; curl the endpoint as super_admin and inspect errorRate, p95, and any timestamp field.
  - Test: Given seeded metrics, when GET api-monitoring, then each row has errorRate (documented unit), p95Ms number and top-level generatedAt ISO string.
  - If wrong: Operators misread error rate by 100x or act on stale data during incidents.
- [ ] **GAP-CHANGE-CALENDAR-06** (low, unverified-service-absent) `['GET /api/v1/admin/change/freezes']`
  - Q: Does the freezes route return {data:[...]} with start/end/reason and is it readable by any change-module role?
  - Verify: Open admin-service change freezes route and schema; curl with requester role expecting 200.
  - Test: Given a seeded freeze, when GET freezes as requester, then 200 with window fields ISO-8601 and correct timezone.
  - If wrong: Calendar hides freezes so changes get scheduled in blackout; medium.
- [ ] **GAP-CHANGE-DETAIL-06** (low, unverified-service-absent) `['GET /api/v1/admin/change/requests/:id', 'POST /v1/admin/change/requests/:id/{submit,approve,reject,schedule,rollback-plan}']`
  - Q: Is every lifecycle transition audited server-side with actor, and does approve enforce maker-checker (approver != requester)?
  - Verify: Open admin-service change module transitions; approve own request as requester expecting 403/409; inspect audit table after each transition.
  - Test: Given requester approves own change, when POST approve, then 403 MAKER_CHECKER; given valid CAB approver, then 200 and audit row with actor and before/after status.
  - If wrong: Self-approved production changes; high.
- [ ] **GAP-TENANT-ADMIN-COMPLIANCE-05** (low, unverified-service-absent) `['GET /api/v1/admin/compliance']`
  - Q: Does admin-service expose GET /v1/admin/compliance, restricted to tenant_admin/platform_admin, returning the shape web's getComplianceOverview maps?
  - Verify: In admin-service open the compliance route file; check preHandler role guard and response schema; curl with tenant_admin (200) and a plain user token (403).
  - Test: Given a non-admin token, when GET /v1/admin/compliance, then 403; given tenant_admin, then 200 with tenantId-scoped scores only.
  - If wrong: Missing route means page always empty; missing role guard leaks compliance posture.
- [ ] **GAP-TENANT-ADMIN-DATA-EXPORT-06** (low, unverified-service-absent) `['GET/POST /api/v1/admin/data-exports (DataExportClient.tsx:49 POST returns 202)']`
  - Q: Do completed data exports expire and become undownloadable exactly 48 hours after completion, with expiresAt returned in the API?
  - Verify: Open the export job worker and download route in admin-service; check storage lifecycle/TTL and expiresAt column; create an export, advance clock 48h+1m, request download.
  - Test: Given an export completed at T, when download is requested at T+48h01m, then 410 Gone and the object is deleted; at T+47h it returns 200.
  - If wrong: Personal-data export links remaining live beyond stated expiry is a DPDP exposure.
- [ ] **GAP-TENANT-ADMIN-DOMAIN-05** (low, unverified-service-absent) `['POST /api/v1/admin/custom-domains', 'POST /api/v1/admin/custom-domains/:id/verify', 'DELETE /api/v1/admin/custom-domains/:id (DomainClient.tsx:40,65,70, direct fetch, credentials same-origin)']`
  - Q: Do the direct /api/v1/admin/* calls authenticate via the session cookie/CSRF at the gateway exactly like /api/proxy/* writes, with tenant scoping and role check?
  - Verify: Compare the Next route handling /api/v1/admin/* with /api/proxy/[...path] (auth header injection, CSRF/device binding); in admin-service check custom-domains routes require tenant_admin; call without cookie expecting 401 and cross-tenant id expecting 404.
  - Test: Given a request lacking session/CSRF, when POST /api/v1/admin/custom-domains, then 401/403; given tenant A admin deleting tenant B domain id, then 404.
  - If wrong: Unauthenticated or cross-tenant domain hijack (tenant takeover) if direct path bypasses proxy controls.
- [ ] **GAP-TENANT-ADMIN-HOME-06** (low, unverified-service-absent) `['GET /api/v1/admin/health', 'GET /api/v1/admin/health/readiness (loaders.ts:919,928)']`
  - Q: What do health.status (ok/degraded/down) and readiness percent mean, and is readiness computed from real checks rather than static values?
  - Verify: Open admin-service health aggregator and readiness handler; list the checks and thresholds; stop one dependency and curl /v1/admin/health.
  - Test: Given one downstream service failing, when GET /v1/admin/health, then status=degraded and that service listed with status down.
  - If wrong: False green health hides outages from tenant admins.
- [ ] **GAP-TENANT-ADMIN-OPERATIONS-06** (low, unverified-service-absent) `['GET /api/v1/admin/operations']`
  - Q: Is the PM2 fleet snapshot a deployment-agnostic abstraction, or does it fail (with a clear status) on hosts/containers without PM2?
  - Verify: Open admin-service operations collector; run it in a container without pm2 and curl.
  - Test: Given no PM2 daemon, when GET /v1/admin/operations, then 200 with processes=[] and mode='unavailable' rather than 500.
  - If wrong: Operations page unusable on Kubernetes/ECS deployments.
- [ ] **GAP-TENANT-ADMIN-ORG-HIERARCHY-05** (low, unverified-service-absent) `['GET /api/v1/admin/org-hierarchy (loaders.ts:4666)']`
  - Q: Is headCount direct reports/employees of the node only, or rolled up including descendants?
  - Verify: Open admin-service org-hierarchy query; check whether count aggregates via recursive CTE; compare parent with sum of children.
  - Test: Given parent with 2 children of 5 employees each and 1 direct, when read, then headCount is documented (1 direct or 11 rolled-up) and consistent.
  - If wrong: Misleading headcount reporting and budgeting.
- [ ] **GAP-TENANT-ADMIN-READINESS-06** (low, unverified-service-absent) `['GET /api/v1/admin/health/readiness (loaders.ts:928)']`
  - Q: How is the readiness percentage computed (checks, weights, pass criteria) and is it derived from live state?
  - Verify: Open the readiness computation in admin-service; list checks and weights; toggle one setting and re-curl.
  - Test: Given 3 of 4 equally weighted checks passing, when GET readiness, then score=75 and failed check listed.
  - If wrong: Tenants go live believing they are ready when they are not.
- [ ] **GAP-TENANT-ADMIN-SETTINGS-07** (low, unverified-service-absent) `['POST /api/proxy/v1/admin/tenant/modules/:key/toggle (ModuleToggleActions.tsx:53)']`
  - Q: Does the toggle endpoint require tenant_admin, validate key against known modules, enforce approval/maker-checker when required, and emit an audit event?
  - Verify: Open admin-service tenant modules toggle route; check audit emit call and comment claim at ModuleToggleActions.tsx:16-18.
  - Test: Given unknown module key, when toggle, then 404/422; valid toggle emits module.toggled audit with actor, before, after.
  - If wrong: Untracked entitlement changes; compliance audit gap.
- [ ] **GAP-TENANT-ADMIN-SIEM-06** (low, unverified-service-absent) `['GET /api/v1/admin/siem/alerts (loaders.ts:4567)']`
  - Q: What are the alert lifecycle states (open, acknowledged, resolved, suppressed) and is there an endpoint to transition them?
  - Verify: Open admin-service or siem module alert schema/enum and transitions; curl list with mixed states.
  - Test: Given an alert in each state, when listed, then state within enum and transition endpoint rejects illegal moves.
  - If wrong: Alerts mishandled or hidden from responders.
- [ ] **GAP-TENANT-ADMIN-USAGE-06** (low, unverified-service-absent) `['GET /api/v1/admin/usage (loaders.ts:4550)']`
  - Q: Which resources does the usage endpoint return, and is the projection (forecast/exhaustion date) computed server-side with a documented model?
  - Verify: Open admin-service usage handler; list resource keys, unit, limit, projection formula.
  - Test: Given usage 80/100 growing 10/day, when read, then projected exhaustion in 2 days per documented model.
  - If wrong: Quota overrun surprises; misleading forecasts.

## procurement-service (38)

- [ ] **GAP-PROCUREMENT-PLANNING-DETAIL-01** (high, unverified-service-absent) `['POST /api/proxy/v1/procurement/plans/:id/approve', 'POST .../plans/:id/reject']`
  - Q: Does approve/reject require an approver role and reject when caller == submittedBy (SoD), and does it emit audit?
  - Verify: Open plan approve/reject handlers (planning/routes.ts); submit a plan as U then approve as U expecting 403 SOD_VIOLATION.
  - Test: Given plan submitted by U, when U POSTs approve, then 403 and status stays pending; another approver gets 200 and an audit event.
  - If wrong: Self-approval of procurement plans; control failure in a high-risk area.
- [ ] **GAP-PROCUREMENT-VENDORS-DETAIL-02** (high, unverified-service-absent) `['PATCH/POST /api/v1/procurement/vendors/:id/(empanel|suspend|blacklist)', 'GET /api/v1/procurement/empanelment']`
  - Q: Which endpoint changes vendor status, who may call it, does it require a reason and audit?
  - Verify: Search the vendors routes for status transition endpoints; call as officer and as viewer.
  - Test: Given a viewer token, when blacklisting a vendor, then 403; given an authorised role, then status=blacklisted with reason and audit event.
  - If wrong: No controlled path to blacklist; compliance risk.
- [ ] **GAP-PROCUREMENT-ORDERS-03** (medium, unverified-service-absent) `['POST /api/proxy/v1/procurement/pos', 'POST .../pos/:id/approve']`
  - Q: Which roles may create and approve POs, and is approver != creator enforced?
  - Verify: Open role guards on the PO create/approve routes; call create with a viewer token expecting 403.
  - Test: Given a user with only viewer role, when POST /pos, then 403 FORBIDDEN.
  - If wrong: Any user could raise purchase commitments.
- [ ] **GAP-PROCUREMENT-ORDERS-DETAIL-03** (medium, unverified-service-absent) `['POST /api/proxy/v1/procurement/pos/:id/dispatch']`
  - Q: Does dispatch enforce a role gate and maker-checker (dispatcher != creator/approver), require an approved PO, and accept optional mode/note/expectedDelivery?
  - Verify: Open the dispatch handler; dispatch with the creator's token expecting 403, with a non-procurement role expecting 403, and on an unapproved PO expecting 409.
  - Test: Given PO created by U and approved, when U dispatches, then 403 SOD_VIOLATION; when a different procurement_officer dispatches, then 200, status=dispatched and audit emitted.
  - If wrong: Irreversible vendor-facing commitment without separation of duties; GFR non-compliance.
- [ ] **GAP-PROCUREMENT-ORDERS-DETAIL-AMEND-03** (medium, unverified-service-absent) `['POST /api/proxy/v1/procurement/pos/:id/amendments']`
  - Q: Does POST amendments reject with 409/422 when the PO status is not an amendable one (draft, cancelled, closed)?
  - Verify: Open the PO amendment handler/state machine; POST an amendment on a draft and a cancelled PO with a valid token and expect 409 INVALID_STATE.
  - Test: Given a cancelled PO, when POST /pos/:id/amendments, then 409 and no amendment row or audit event is created.
  - If wrong: Amendments to non-live POs corrupt commitments and vendor obligations.
- [ ] **GAP-PROCUREMENT-PRE-BID-04** (medium, unverified-service-absent) `['GET /api/v1/procurement/pre-bid-conferences']`
  - Q: Is the conference date returned as ISO 8601 and is the tender field a stable id plus display name?
  - Verify: Open the response schema; curl the endpoint and inspect conferenceDate and tender fields.
  - Test: Given a conference, when listing, then conferenceDate matches ISO date-time and tenderNo/tenderTitle are separate fields.
  - If wrong: Wrong or ambiguous dates shown to bidders' officers.
- [ ] **GAP-PROCUREMENT-RFQ-NEW-03** (medium, unverified-service-absent) `['POST /api/proxy/v1/procurement/rfqs']`
  - Q: Does the server issue a unique sequential rfqNo (ignoring client value) and accept line items on create?
  - Verify: Open the POST /rfqs handler and its number sequence; POST twice with the same client rfqNo and expect distinct server numbers; check whether items are in the schema.
  - Test: Given two concurrent creates, when both POST, then rfqNo values are unique and sequential.
  - If wrong: Duplicate RFQ numbers; missing items.
- [ ] **GAP-PROCUREMENT-BID-EVALUATION-06** (low, unverified-service-absent) `['GET /api/v1/procurement/bid-evaluations']`
  - Q: Financial scores must be withheld until technical evaluation is complete and opened (sealed-bid), and reads audited; role-limited to evaluation committee.
  - Verify: Open the bid-evaluations handler; check status gating of financial fields. curl as evaluator before technical opening expecting financial fields absent.
  - Test: Given tender in TECHNICAL stage, when GET bid-evaluations, then financialScore is null.
  - If wrong: Bid-rigging exposure, GFR breach.
- [ ] **GAP-PROCUREMENT-DASHBOARD-05** (low, unverified-service-absent) `['GET /api/v1/procurement/dashboard']`
  - Q: Define grnsThisMonth (calendar month in tenant timezone, accepted GRNs only?) and the contractRenewalsDue window (e.g. 90 days).
  - Verify: Open dashboard query in procurement-service; read date filters and status conditions.
  - Test: Given GRNs on the 31st and 1st in IST, when dashboard, then month boundary uses tenant timezone.
  - If wrong: Misleading KPIs.
- [ ] **GAP-PROCUREMENT-EMD-BG-06** (low, unverified-service-absent) `['GET /api/v1/procurement/emd', 'GET /api/v1/procurement/pbg']`
  - Q: Forfeiture/release transitions must be role-guarded, audited, and linked to PFMS/treasury refs.
  - Verify: Open emd/pbg routes and state machine; try release as non-finance role.
  - Test: Given an EMD, when a non-finance user forfeits, then 403 and audit records actor otherwise.
  - If wrong: Improper release or forfeiture of security deposits.
- [ ] **GAP-PROCUREMENT-EMPANELMENT-05** (low, unverified-service-absent) `['GET /api/v1/procurement/empanelment']`
  - Q: Category master, validity dates and who may empanel must be enforced server-side and consistent with vendor register.
  - Verify: Open empanelment route/schema; check validTo enforcement and role guard.
  - Test: Given expired empanelment, when a PO is raised for vendor, then rejected.
  - If wrong: Purchases from unempanelled vendors.
- [ ] **GAP-PROCUREMENT-GEM-06** (low, unverified-service-absent) `['GET /api/v1/procurement/gem/items']`
  - Q: GeM item data import path and authenticity (source, checksum, imported-by) must be recorded.
  - Verify: Open gem/items route and import job; check source metadata.
  - Test: Given a manual upload, when listed, then source=manual and importedBy set.
  - If wrong: Unverified GeM prices used for purchase decisions.
- [ ] **GAP-PROCUREMENT-GRN-05** (low, unverified-service-absent) `['GET /api/v1/procurement/grns']`
  - Q: List must be scoped by tenant and by user's store/department assignment.
  - Verify: Open list query; call as store user of store A.
  - Test: Given GRNs in stores A/B, when store A user lists, then only A.
  - If wrong: Cross-department data visibility.
- [ ] **GAP-PROCUREMENT-GRN-DETAIL-06** (low, unverified-service-absent) `['PATCH /api/v1/procurement/grns/:id/accept|reject', 'PATCH /api/v1/procurement/grns/:id']`
  - Q: Accept/reject/amend must audit, post stock only on accept (once), and enforce SoD vs creator.
  - Verify: Open GRN handlers; accept twice; accept as creator.
  - Test: Given accepted GRN, when accept again, then 409 and stock unchanged.
  - If wrong: Stock inflation or unaudited edits.
- [ ] **GAP-PROCUREMENT-GRN-NEW-06** (low, unverified-service-absent) `['POST /api/v1/procurement/grns']`
  - Q: createdBy must be captured from the JWT (not body) and received qty must not exceed PO open qty.
  - Verify: Open GRN create; POST with forged createdBy and over-qty.
  - Test: Given PO open qty 10, when POST received 11, then 422; createdBy equals token subject.
  - If wrong: SoD bypass and over-receipt.
- [ ] **GAP-PROCUREMENT-INDENTS-05** (low, unverified-service-absent) `['GET /api/v1/procurement/indents']`
  - Q: Does the list handler filter indents by the caller's department/requester unless the caller holds a procurement-wide role?
  - Verify: Open the indents list route in procurement-service; call with a clerk token of dept A and expect only dept A indents, and a procurement_officer token expecting all.
  - Test: Given indents in depts A and B, when a dept-A clerk GETs /indents, then only dept-A rows (and total) are returned.
  - If wrong: Cross-department disclosure of purchase demand; DPDP/least-privilege breach.
- [ ] **GAP-PROCUREMENT-INDENTS-DETAIL-05** (low, unverified-service-absent) `['GET /api/v1/procurement/indents/:id']`
  - Q: approvalTrail must include actor, action, timestamp and rejection reason for every step.
  - Verify: Open indent detail serializer; reject an indent with reason and GET.
  - Test: Given rejected indent, when GET, then approvalTrail last entry has reason and actor.
  - If wrong: Incomplete audit trail.
- [ ] **GAP-PROCUREMENT-INDENTS-NEW-06** (low, unverified-service-absent) `['POST /api/v1/procurement/indents', 'GET /api/v1/procurement/gfr/mode-bands?estimatedValueMinor=']`
  - Q: Indent create must audit and enforce maker-checker; mode-bands must return GFR thresholds server-side and the server must re-derive procurement mode.
  - Verify: Open indents POST and gfr/mode-bands; POST with a mode inconsistent with value.
  - Test: Given value above Rs 25 lakh, when POST mode=direct, then 422.
  - If wrong: Wrong procurement mode chosen, GFR breach.
- [ ] **GAP-PROCUREMENT-ORDERS-06** (low, unverified-service-absent) `['GET /api/v1/procurement/pos']`
  - Q: Is the PO list tenant/department scoped, is poNo server-issued unique and sequential, and is the GeM-placed linkage returned as a field?
  - Verify: Open the list handler and PO number sequence; list as dept user and confirm scoping and presence of gemOrderRef.
  - Test: Given POs across tenants, when listing, then only own-tenant rows are returned.
  - If wrong: Cross-tenant leakage; duplicate PO numbers.
- [ ] **GAP-PROCUREMENT-ORDERS-DETAIL-06** (low, unverified-service-absent) `['GET /api/v1/procurement/pos/:id', 'GET /api/proxy/v1/procurement/pos/:id/pdf', 'POST .../pos/:id/dispatch', 'POST .../pos/:id/submit-approval']`
  - Q: Do the PO state machine, PDF generation and submit/dispatch transitions enforce legal transitions and emit audit events?
  - Verify: Open the PO routes/domain; walk draft->pending_approval->approved->dispatched via curl, attempting illegal jumps (expect 409), and fetch the PDF checking PO number, vendor, lines and totals.
  - Test: Given a draft PO, when dispatch is called, then 409; when submit-approval is called, then status pending_approval and audit event emitted.
  - If wrong: Invalid PO states and missing audit trail on purchase commitments.
- [ ] **GAP-PROCUREMENT-ORDERS-DETAIL-AMEND-06** (low, unverified-service-absent) `['GET /api/v1/procurement/pos/:id/amendments', 'POST /api/proxy/v1/procurement/pos/:id/amendments']`
  - Q: Do POST amendments require a distinct approver (SoD), carry a status field, and emit an audit event?
  - Verify: Open the amendments route and schema; POST as creator then attempt approval as same user expecting 403; check the audit emit call and response fields.
  - Test: Given an amendment created by user U, when U approves it, then 403 SOD_VIOLATION; when another approver approves, then status=approved and an audit event exists.
  - If wrong: Unapproved value changes to a binding vendor PO; audit gap.
- [ ] **GAP-PROCUREMENT-ORDERS-NEW-06** (low, unverified-service-absent) `['POST /api/proxy/v1/procurement/pos']`
  - Q: Does PO creation validate with zod, reject vendors not empanelled/blacklisted, issue the PO number server-side, and emit audit?
  - Verify: Open the POST /pos handler; create a PO for a blacklisted vendor expecting 422/409, and a valid one expecting a server-issued poNo and an audit event.
  - Test: Given a blacklisted vendor, when POST /pos, then 422 VENDOR_NOT_ELIGIBLE and no row is written.
  - If wrong: Orders placed with debarred vendors; GFR violation.
- [ ] **GAP-PROCUREMENT-PLANNING-06** (low, unverified-service-absent) `['GET /api/v1/procurement/plans']`
  - Q: Is the plans list scoped by department, and which roles may view other departments' plans?
  - Verify: Open the list handler; call with dept A user and confirm dept B plans are absent unless role is procurement/finance.
  - Test: Given plans in depts A and B, when dept-A user lists, then only A plans returned.
  - If wrong: Cross-department disclosure of procurement intent.
- [ ] **GAP-PROCUREMENT-PLANNING-DETAIL-06** (low, unverified-service-absent) `['GET /api/v1/procurement/plans/:id', 'POST .../plans/:id/submit|approve|reject']`
  - Q: Does the plan state machine (draft->submitted->approved/rejected) reject illegal transitions and emit an audit event on each?
  - Verify: Open planning/schema.ts and routes.ts; attempt approve on a draft (expect 409) and check audit emits.
  - Test: Given a draft plan, when approve is called, then 409 INVALID_STATE.
  - If wrong: Plans bypass review; no audit trail.
- [ ] **GAP-PROCUREMENT-PLANNING-NEW-06** (low, unverified-service-absent) `['POST /api/proxy/v1/procurement/plans']`
  - Q: Does plan creation zod-validate, issue planNo server-side and emit audit?
  - Verify: Open POST /plans handler; send invalid body expecting 422 with field errors and valid body expecting planNo and audit event.
  - Test: Given an empty items array, when POST /plans, then 422.
  - If wrong: Malformed plans and untraceable creation.
- [ ] **GAP-PROCUREMENT-PRE-BID-06** (low, unverified-service-absent) `['GET /api/v1/procurement/pre-bid-conferences']`
  - Q: Which roles may create conferences and how are bidder queries linked to tender clarifications?
  - Verify: Open the pre-bid routes and schema; POST as non-procurement role expecting 403; check queries foreign key to tender clarification.
  - Test: Given a viewer token, when POST a conference, then 403.
  - If wrong: Unauthorised conferences; disconnected clarification record (transparency).
- [ ] **GAP-PROCUREMENT-REVERSE-AUCTION-06** (low, unverified-service-absent) `['GET /api/v1/procurement/reverse-auctions']`
  - Q: Does the API mask bidder identities during a live auction and enforce GeM/GFR rules (decrement, timing)?
  - Verify: Open the auction handler; GET as buyer during live auction and confirm bidder names are anonymised (Bidder-1..n).
  - Test: Given a live auction, when the buyer lists bids, then bidder identity fields are absent.
  - If wrong: Collusion risk; auction integrity.
- [ ] **GAP-PROCUREMENT-RFQ-05** (low, unverified-service-absent) `['GET /api/v1/procurement/rfqs']`
  - Q: Is the RFQ status enum exactly draft/issued/closed/awarded and is it returned consistently?
  - Verify: Open the RFQ schema enum; curl list and compare status values to the web badge map.
  - Test: Given each status, when listed, then the value is in the documented enum.
  - If wrong: Unmapped statuses render blank in UI.
- [ ] **GAP-PROCUREMENT-RFQ-DETAIL-06** (low, unverified-service-absent) `['GET /api/v1/procurement/rfqs/:id']`
  - Q: Are vendor responses hidden until the RFQ closing time, and is access role-scoped?
  - Verify: Open the rfq detail handler; GET before closing time as buyer and expect no quoted prices.
  - Test: Given an open RFQ before deadline, when GET :id, then responses array is empty/redacted.
  - If wrong: Premature price disclosure breaks fair procurement.
- [ ] **GAP-PROCUREMENT-RFQ-NEW-06** (low, unverified-service-absent) `['POST /api/proxy/v1/procurement/rfqs']`
  - Q: Does RFQ creation validate, notify vendors only on issue, and emit audit?
  - Verify: Open the handler; create draft and confirm no notification, issue and confirm queue event and audit.
  - Test: Given a draft RFQ, when created, then no vendor notification is enqueued.
  - If wrong: Vendors alerted prematurely; missing audit.
- [ ] **GAP-PROCUREMENT-TENDERS-05** (low, unverified-service-absent) `['GET /api/v1/procurement/tenders']`
  - Q: Is the tender status enum draft/published/technical_evaluation/financial_evaluation/awarded exact and complete (cancelled?)?
  - Verify: Open the tender status enum; compare with the web status map.
  - Test: Given each state, when listed, then value belongs to the documented enum.
  - If wrong: Unmapped status in list.
- [ ] **GAP-PROCUREMENT-TENDERS-DETAIL-06** (low, unverified-service-absent) `['GET /api/v1/procurement/tenders/:id', 'POST .../tenders/:id/publish|technical-evaluation|open-financial|award']`
  - Q: Does the tender state machine block illegal transitions, keep sealed bids encrypted until opening, select L1 correctly and generate the PO on award with audit?
  - Verify: Open tender/routes.ts and domain.ts; call open-financial on a draft expecting 409; GET before opening and confirm no financial bids in response.
  - Test: Given a tender in technical_evaluation, when award is called, then 409; sealed price fields are absent before open-financial.
  - If wrong: Bid leakage, wrong award; legal challenge.
- [ ] **GAP-PROCUREMENT-TENDERS-DETAIL-DOCUMENTS-06** (low, unverified-service-absent) `['GET/POST /api/proxy/v1/procurement/tenders/:id/documents', 'GET /api/proxy/v1/admin/uploads/:storageRef']`
  - Q: Are uploads presigned with type/size limits, malware-scanned before availability, role-gated and audited?
  - Verify: Open the documents route and upload service; upload an EICAR file expecting rejection or quarantine, and a download by an unauthorised role expecting 403.
  - Test: Given an EICAR test file, when uploaded to a tender, then it is quarantined and not downloadable.
  - If wrong: Malware or unauthorised access to tender documents.
- [ ] **GAP-PROCUREMENT-TENDERS-NEW-06** (low, unverified-service-absent) `['POST /api/proxy/v1/procurement/tenders']`
  - Q: Does the server issue tenderNo, validate dates (closing after publish) and emit audit?
  - Verify: Open the POST handler; send closing date in the past expecting 422 and check tenderNo issued.
  - Test: Given closingDate < today, when POST, then 422.
  - If wrong: Invalid tenders or duplicate numbers.
- [ ] **GAP-PROCUREMENT-VENDORS-06** (low, unverified-service-absent) `['GET /api/v1/procurement/vendors', 'PATCH .../vendors/:id/status']`
  - Q: Which roles may change empanelment status?
  - Verify: Open the status route role guard; call as clerk expecting 403.
  - Test: Given clerk token, when changing vendor status, then 403.
  - If wrong: Unauthorised empanelment.
- [ ] **GAP-PROCUREMENT-VENDORS-DETAIL-06** (low, unverified-service-absent) `['GET /api/v1/procurement/vendors/:id']`
  - Q: Are sensitive vendor fields (PAN, bank account, GSTIN) masked or role-limited?
  - Verify: Open the vendor serializer; GET as viewer and confirm bank/PAN are masked.
  - Test: Given a viewer token, when GET vendor, then bankAccount is masked.
  - If wrong: PII/financial data exposure.
- [ ] **GAP-PROCUREMENT-VENDORS-DETAIL-SCORECARD-06** (low, unverified-service-absent) `['GET /api/v1/procurement/vendors/:id/scorecard']`
  - Q: How are the scores (GRN acceptance, completion, SLA) computed, and how often refreshed?
  - Verify: Open the scorecard service; compare with sample GRN/PO data by hand and note the job schedule.
  - Test: Given 8 accepted of 10 GRNs, when scorecard computed, then acceptance=80.
  - If wrong: Vendors rated on wrong data.
- [ ] **GAP-PROCUREMENT-VENDORS-NEW-06** (low, unverified-service-absent) `['POST /api/proxy/v1/procurement/vendors']`
  - Q: Is initial empanelment status forced to pending regardless of client input, and is creation audited and de-duplicated on PAN/GSTIN?
  - Verify: Open the POST handler; POST status=empanelled expecting it ignored or 422; POST duplicate PAN expecting 409.
  - Test: Given body status=empanelled, when POST, then stored status=pending.
  - If wrong: Bypass of empanelment check.

## works-service (36)

- [ ] **GAP-WORKS-MASTERS-02** (high, unverified-service-absent) `['POST /v1/works/masters/:type']`
  - Q: Does POST masters/:type require a masters-admin role, and is it audited?
  - Verify: Open masters create handler; curl as a plain works user (expect 403) and as masters admin (expect 201 + audit).
  - Test: Given non-admin, when POST masters/tender-types, then 403; admin then 201 and audit row.
  - If wrong: Any user can change tender types, contractor classes, SR rates: fraud/integrity risk.
- [ ] **GAP-WORKS-HOME-02** (medium, unverified-service-absent) `['GET /api/v1/works/dashboard']`
  - Q: What are the exact byStatus keys returned (draft, submitted, pending, completed) for the dashboard?
  - Verify: Open dashboard handler and status enum in works-service; curl and list byStatus keys.
  - Test: Given works in each status, when GET dashboard, then byStatus keys equal the enum set used by page.tsx:49-50.
  - If wrong: Dashboard counts show 0 while records exist.
- [ ] **GAP-WORKS-APPROVALS-06** (low, unverified-service-absent) `['GET /api/v1/works/approvals/aa?pageSize=100', 'GET /api/v1/works/approvals/ts?pageSize=100']`
  - Q: Do GET /api/v1/works/approvals/aa?pageSize=100, GET /api/v1/works/approvals/ts?pageSize=100 enforce works approvals reader role checks, input validation, canonical status enums and the documented response shape?
  - Verify: In works-service open the route/handler for GET /api/v1/works/approvals/aa?pageSize=100 and its schema; curl each endpoint as a role without works approvals reader (expect 403), as a valid role with a bad body (expect 422 with field errors) and compare a 200 body to the row type in apps/web/src/app/(app)/works/_data/types.ts.
  - Test: Given a user lacking works approvals reader, when calling GET /api/v1/works/approvals/aa?pageSize=100, then 403 and no audit-visible change; given a valid user, then 200 with {data:[...]} matching types.ts.
  - If wrong: Unauthorised access or malformed data in works records; page renders blank/incorrect values.
- [ ] **GAP-WORKS-APPROVALS-AA-DETAIL-06** (low, unverified-service-absent) `['GET /api/v1/works/approvals/aa?pageSize=100', 'POST /api/proxy/v1/works/approvals/aa/:id/finalize']`
  - Q: Do GET /api/v1/works/approvals/aa?pageSize=100, POST /api/proxy/v1/works/approvals/aa/:id/finalize enforce AA approver role checks, input validation, canonical status enums and the documented response shape and does list-then-find return the row for a given id?
  - Verify: In works-service open the route/handler for GET /api/v1/works/approvals/aa?pageSize=100 and its schema; curl each endpoint as a role without AA approver (expect 403), as a valid role with a bad body (expect 422 with field errors) and compare a 200 body to the row type in apps/web/src/app/(app)/works/_data/types.ts.
  - Test: Given a user lacking AA approver, when calling GET /api/v1/works/approvals/aa?pageSize=100, then 403 and no audit-visible change; given a valid user, then 200 with {data:[...]} matching types.ts.
  - If wrong: Unauthorised access or malformed data in works records; page renders blank/incorrect values.
- [ ] **GAP-WORKS-APPROVALS-NEW-05** (low, unverified-service-absent) `['POST /v1/works/approvals/aa']`
  - Q: Do POST /v1/works/approvals/aa enforce AA creator role checks, input validation, canonical status enums and the documented response shape?
  - Verify: In works-service open the route/handler for POST /v1/works/approvals/aa and its schema; curl each endpoint as a role without AA creator (expect 403), as a valid role with a bad body (expect 422 with field errors) and compare a 200 body to the row type in apps/web/src/app/(app)/works/_data/types.ts.
  - Test: Given a user lacking AA creator, when calling POST /v1/works/approvals/aa, then 403 and no audit-visible change; given a valid user, then 200 with {data:[...]} matching types.ts.
  - If wrong: Unauthorised access or malformed data in works records; page renders blank/incorrect values.
- [ ] **GAP-WORKS-APPROVALS-TS-DETAIL-06** (low, unverified-service-absent) `['GET /api/v1/works/approvals/ts?pageSize=100', 'POST /v1/works/approvals/ts/:id/finalize']`
  - Q: Do GET /api/v1/works/approvals/ts?pageSize=100, POST /v1/works/approvals/ts/:id/finalize enforce TS approver role checks, input validation, canonical status enums and the documented response shape?
  - Verify: In works-service open the route/handler for GET /api/v1/works/approvals/ts?pageSize=100 and its schema; curl each endpoint as a role without TS approver (expect 403), as a valid role with a bad body (expect 422 with field errors) and compare a 200 body to the row type in apps/web/src/app/(app)/works/_data/types.ts.
  - Test: Given a user lacking TS approver, when calling GET /api/v1/works/approvals/ts?pageSize=100, then 403 and no audit-visible change; given a valid user, then 200 with {data:[...]} matching types.ts.
  - If wrong: Unauthorised access or malformed data in works records; page renders blank/incorrect values.
- [ ] **GAP-WORKS-APPROVALS-TS-NEW-05** (low, unverified-service-absent) `['POST /v1/works/approvals/ts']`
  - Q: Do POST /v1/works/approvals/ts enforce TS creator role checks, input validation, canonical status enums and the documented response shape?
  - Verify: In works-service open the route/handler for POST /v1/works/approvals/ts and its schema; curl each endpoint as a role without TS creator (expect 403), as a valid role with a bad body (expect 422 with field errors) and compare a 200 body to the row type in apps/web/src/app/(app)/works/_data/types.ts.
  - Test: Given a user lacking TS creator, when calling POST /v1/works/approvals/ts, then 403 and no audit-visible change; given a valid user, then 200 with {data:[...]} matching types.ts.
  - If wrong: Unauthorised access or malformed data in works records; page renders blank/incorrect values.
- [ ] **GAP-WORKS-BILLING-05** (low, unverified-service-absent) `['GET /api/v1/works/billing/bills?pageSize=100']`
  - Q: Do GET /api/v1/works/billing/bills?pageSize=100 enforce billing reader role checks, input validation, canonical status enums and the documented response shape?
  - Verify: In works-service open the route/handler for GET /api/v1/works/billing/bills?pageSize=100 and its schema; curl each endpoint as a role without billing reader (expect 403), as a valid role with a bad body (expect 422 with field errors) and compare a 200 body to the row type in apps/web/src/app/(app)/works/_data/types.ts.
  - Test: Given a user lacking billing reader, when calling GET /api/v1/works/billing/bills?pageSize=100, then 403 and no audit-visible change; given a valid user, then 200 with {data:[...]} matching types.ts.
  - If wrong: Unauthorised access or malformed data in works records; page renders blank/incorrect values.
- [ ] **GAP-WORKS-BILLING-ACCOUNT-COMPILE-05** (low, unverified-service-absent) `['POST /v1/works/billing/account-compile']`
  - Q: Do POST /v1/works/billing/account-compile enforce billing accountant role checks, input validation, canonical status enums and the documented response shape?
  - Verify: In works-service open the route/handler for POST /v1/works/billing/account-compile and its schema; curl each endpoint as a role without billing accountant (expect 403), as a valid role with a bad body (expect 422 with field errors) and compare a 200 body to the row type in apps/web/src/app/(app)/works/_data/types.ts.
  - Test: Given a user lacking billing accountant, when calling POST /v1/works/billing/account-compile, then 403 and no audit-visible change; given a valid user, then 200 with {data:[...]} matching types.ts.
  - If wrong: Unauthorised access or malformed data in works records; page renders blank/incorrect values.
- [ ] **GAP-WORKS-BILLING-BILLS-NEW-05** (low, unverified-service-absent) `['POST /v1/works/billing/bills']`
  - Q: Do POST /v1/works/billing/bills enforce billing creator role checks, input validation, canonical status enums and the documented response shape?
  - Verify: In works-service open the route/handler for POST /v1/works/billing/bills and its schema; curl each endpoint as a role without billing creator (expect 403), as a valid role with a bad body (expect 422 with field errors) and compare a 200 body to the row type in apps/web/src/app/(app)/works/_data/types.ts.
  - Test: Given a user lacking billing creator, when calling POST /v1/works/billing/bills, then 403 and no audit-visible change; given a valid user, then 200 with {data:[...]} matching types.ts.
  - If wrong: Unauthorised access or malformed data in works records; page renders blank/incorrect values.
- [ ] **GAP-WORKS-BILLING-MEASUREMENTS-NEW-05** (low, unverified-service-absent) `['POST /v1/works/billing/measurements']`
  - Q: Do POST /v1/works/billing/measurements enforce measurement recorder role checks, input validation, canonical status enums and the documented response shape?
  - Verify: In works-service open the route/handler for POST /v1/works/billing/measurements and its schema; curl each endpoint as a role without measurement recorder (expect 403), as a valid role with a bad body (expect 422 with field errors) and compare a 200 body to the row type in apps/web/src/app/(app)/works/_data/types.ts.
  - Test: Given a user lacking measurement recorder, when calling POST /v1/works/billing/measurements, then 403 and no audit-visible change; given a valid user, then 200 with {data:[...]} matching types.ts.
  - If wrong: Unauthorised access or malformed data in works records; page renders blank/incorrect values.
- [ ] **GAP-WORKS-BILLING-NEW-MB-05** (low, unverified-service-absent) `['POST /v1/works/billing/mb', 'POST /v1/works/billing/mb/:id/finalize']`
  - Q: Do POST /v1/works/billing/mb, POST /v1/works/billing/mb/:id/finalize enforce MB recorder role checks, input validation, canonical status enums and the documented response shape?
  - Verify: In works-service open the route/handler for POST /v1/works/billing/mb and its schema; curl each endpoint as a role without MB recorder (expect 403), as a valid role with a bad body (expect 422 with field errors) and compare a 200 body to the row type in apps/web/src/app/(app)/works/_data/types.ts.
  - Test: Given a user lacking MB recorder, when calling POST /v1/works/billing/mb, then 403 and no audit-visible change; given a valid user, then 200 with {data:[...]} matching types.ts.
  - If wrong: Unauthorised access or malformed data in works records; page renders blank/incorrect values.
- [ ] **GAP-WORKS-BILLING-WORKID-07** (low, unverified-service-absent) `['GET /api/v1/works/billing/:workId/bills', 'POST /v1/works/billing/bills/:id/finalize', 'POST /v1/works/billing/mb/:id/finalize']`
  - Q: Do GET /api/v1/works/billing/:workId/bills, POST /v1/works/billing/bills/:id/finalize, POST /v1/works/billing/mb/:id/finalize enforce billing finalizer role checks, input validation, canonical status enums and the documented response shape and are finalize calls idempotent?
  - Verify: In works-service open the route/handler for GET /api/v1/works/billing/:workId/bills and its schema; curl each endpoint as a role without billing finalizer (expect 403), as a valid role with a bad body (expect 422 with field errors) and compare a 200 body to the row type in apps/web/src/app/(app)/works/_data/types.ts.
  - Test: Given a user lacking billing finalizer, when calling GET /api/v1/works/billing/:workId/bills, then 403 and no audit-visible change; given a valid user, then 200 with {data:[...]} matching types.ts.
  - If wrong: Unauthorised access or malformed data in works records; page renders blank/incorrect values.
- [ ] **GAP-WORKS-BOQ-05** (low, unverified-service-absent) `['GET /api/v1/works/boq?pageSize=100']`
  - Q: Do GET /api/v1/works/boq?pageSize=100 enforce BoQ reader role checks, input validation, canonical status enums and the documented response shape?
  - Verify: In works-service open the route/handler for GET /api/v1/works/boq?pageSize=100 and its schema; curl each endpoint as a role without BoQ reader (expect 403), as a valid role with a bad body (expect 422 with field errors) and compare a 200 body to the row type in apps/web/src/app/(app)/works/_data/types.ts.
  - Test: Given a user lacking BoQ reader, when calling GET /api/v1/works/boq?pageSize=100, then 403 and no audit-visible change; given a valid user, then 200 with {data:[...]} matching types.ts.
  - If wrong: Unauthorised access or malformed data in works records; page renders blank/incorrect values.
- [ ] **GAP-WORKS-BOQ-NEW-05** (low, unverified-service-absent) `['POST /v1/works/boq']`
  - Q: Do POST /v1/works/boq enforce BoQ author role checks, input validation, canonical status enums and the documented response shape?
  - Verify: In works-service open the route/handler for POST /v1/works/boq and its schema; curl each endpoint as a role without BoQ author (expect 403), as a valid role with a bad body (expect 422 with field errors) and compare a 200 body to the row type in apps/web/src/app/(app)/works/_data/types.ts.
  - Test: Given a user lacking BoQ author, when calling POST /v1/works/boq, then 403 and no audit-visible change; given a valid user, then 200 with {data:[...]} matching types.ts.
  - If wrong: Unauthorised access or malformed data in works records; page renders blank/incorrect values.
- [ ] **GAP-WORKS-BOQ-WORKID-05** (low, unverified-service-absent) `['GET /api/v1/works/boq/:workId', 'GET /api/v1/works/boq/:workId/recapitulation']`
  - Q: Do GET /api/v1/works/boq/:workId, GET /api/v1/works/boq/:workId/recapitulation enforce BoQ reader role checks, input validation, canonical status enums and the documented response shape and is money returned in one consistent unit?
  - Verify: In works-service open the route/handler for GET /api/v1/works/boq/:workId and its schema; curl each endpoint as a role without BoQ reader (expect 403), as a valid role with a bad body (expect 422 with field errors) and compare a 200 body to the row type in apps/web/src/app/(app)/works/_data/types.ts.
  - Test: Given a user lacking BoQ reader, when calling GET /api/v1/works/boq/:workId, then 403 and no audit-visible change; given a valid user, then 200 with {data:[...]} matching types.ts.
  - If wrong: Unauthorised access or malformed data in works records; page renders blank/incorrect values.
- [ ] **GAP-WORKS-CLOSURE-05** (low, unverified-service-absent) `['GET /api/v1/works/closure?pageSize=100']`
  - Q: Do GET /api/v1/works/closure?pageSize=100 enforce closure reader role checks, input validation, canonical status enums and the documented response shape?
  - Verify: In works-service open the route/handler for GET /api/v1/works/closure?pageSize=100 and its schema; curl each endpoint as a role without closure reader (expect 403), as a valid role with a bad body (expect 422 with field errors) and compare a 200 body to the row type in apps/web/src/app/(app)/works/_data/types.ts.
  - Test: Given a user lacking closure reader, when calling GET /api/v1/works/closure?pageSize=100, then 403 and no audit-visible change; given a valid user, then 200 with {data:[...]} matching types.ts.
  - If wrong: Unauthorised access or malformed data in works records; page renders blank/incorrect values.
- [ ] **GAP-WORKS-CONTRACTORS-06** (low, unverified-service-absent) `['GET /api/v1/works/contractors']`
  - Q: Do GET /api/v1/works/contractors enforce contractor reader role checks, input validation, canonical status enums and the documented response shape?
  - Verify: In works-service open the route/handler for GET /api/v1/works/contractors and its schema; curl each endpoint as a role without contractor reader (expect 403), as a valid role with a bad body (expect 422 with field errors) and compare a 200 body to the row type in apps/web/src/app/(app)/works/_data/types.ts.
  - Test: Given a user lacking contractor reader, when calling GET /api/v1/works/contractors, then 403 and no audit-visible change; given a valid user, then 200 with {data:[...]} matching types.ts.
  - If wrong: Unauthorised access or malformed data in works records; page renders blank/incorrect values.
- [ ] **GAP-WORKS-CONTRACTORS-DETAIL-06** (low, unverified-service-absent) `['GET /api/v1/works/contractors/:id', 'GET /api/v1/works/contractors/:id/rating-history', 'PATCH /v1/works/contractors/:id', 'POST /v1/works/contractors/:id/rate']`
  - Q: Do GET /api/v1/works/contractors/:id, GET /api/v1/works/contractors/:id/rating-history, PATCH /v1/works/contractors/:id, POST /v1/works/contractors/:id/rate enforce contractor manager role checks, input validation, canonical status enums and the documented response shape and is PAN/GST validated on PATCH?
  - Verify: In works-service open the route/handler for GET /api/v1/works/contractors/:id and its schema; curl each endpoint as a role without contractor manager (expect 403), as a valid role with a bad body (expect 422 with field errors) and compare a 200 body to the row type in apps/web/src/app/(app)/works/_data/types.ts.
  - Test: Given a user lacking contractor manager, when calling GET /api/v1/works/contractors/:id, then 403 and no audit-visible change; given a valid user, then 200 with {data:[...]} matching types.ts.
  - If wrong: Unauthorised access or malformed data in works records; page renders blank/incorrect values.
- [ ] **GAP-WORKS-CONTRACTORS-NEW-05** (low, unverified-service-absent) `['POST /v1/works/contractors']`
  - Q: Do POST /v1/works/contractors enforce contractor manager role checks, input validation, canonical status enums and the documented response shape including PAN/GST format and duplicate registrationNo?
  - Verify: In works-service open the route/handler for POST /v1/works/contractors and its schema; curl each endpoint as a role without contractor manager (expect 403), as a valid role with a bad body (expect 422 with field errors) and compare a 200 body to the row type in apps/web/src/app/(app)/works/_data/types.ts.
  - Test: Given a user lacking contractor manager, when calling POST /v1/works/contractors, then 403 and no audit-visible change; given a valid user, then 200 with {data:[...]} matching types.ts.
  - If wrong: Unauthorised access or malformed data in works records; page renders blank/incorrect values.
- [ ] **GAP-WORKS-EXECUTION-06** (low, unverified-service-absent) `['GET /api/v1/works/execution/progress?pageSize=100']`
  - Q: How is progress percentage derived (cumulative/scope quantity) and what is the maximum pageSize the service honours; does the response include total?
  - Verify: Open progress list handler; request pageSize=500 and check clamp and a meta.total field.
  - Test: Given 150 rows, when GET pageSize=100, then response contains total=150 and derived percent within 0-100.
  - If wrong: Works beyond first 100 silently missing; wrong percentages.
- [ ] **GAP-WORKS-EXECUTION-ISSUES-06** (low, unverified-service-absent) `['POST /v1/works/execution/issues/:id/close', 'GET /api/v1/works/execution/issues?pageSize=100']`
  - Q: Is issue close idempotent (second close returns 200/409 without a duplicate audit row) and restricted to a site-engineer/supervisor role?
  - Verify: Open the close handler; curl close twice as authorised user then once as unauthorised (expect 403); count audit rows.
  - Test: Given a closed issue, when close is posted again, then no second audit entry and a defined 200/409; given unauthorised role, then 403.
  - If wrong: Duplicate/unauthorised closure of site issues, corrupting closure audit.
- [ ] **GAP-WORKS-EXECUTION-ISSUES-NEW-05** (low, unverified-service-absent) `['POST /v1/works/execution/issues']`
  - Q: Does POST issues validate title/severity/workId, accept an optional attachmentKey (work_issues.attachmentKey) and write an audit row?
  - Verify: Open the issues create handler and schema in works-service; curl with and without attachmentKey and a nonexistent workId (expect 404/422); check audit table.
  - Test: Given valid body with attachmentKey, when POST issues, then 201, key persisted, audit row; given unknown workId, then 422.
  - If wrong: Issues lack evidence or are created against invalid works without an audit trail.
- [ ] **GAP-WORKS-EXECUTION-PHOTOS-NEW-05** (low, unverified-service-absent) `['POST /v1/admin/uploads/presign', 'POST /v1/works/execution/photos']`
  - Q: Does presign restrict content-type/size for category=photo, is the object virus-scanned and EXIF (GPS/PII) handled, and does photo registration verify the key belongs to the tenant and audit the write?
  - Verify: Open admin uploads presign handler (owned by admin/platform service) and works photos handler; request presign with application/x-msdownload (expect 422), register a key from another tenant (expect 403).
  - Test: Given non-image content-type, when presign category=photo, then 422; given foreign-tenant key, when POST photos, then 403; valid then 201 with audit.
  - If wrong: Malware or cross-tenant objects attached to works; unstripped GPS data leaks.
- [ ] **GAP-WORKS-EXECUTION-RECORD-PROGRESS-06** (low, unverified-service-absent) `['GET|POST /v1/works/execution/:workId/scopes', 'POST /v1/works/execution/progress']`
  - Q: Does POST progress enforce one entry per scope per month, cumulative quantity <= scope quantity, and write an audit row?
  - Verify: Open progress handler and DB unique constraint; curl the same scope-month twice (expect 409) and a quantity over the remaining cap (expect 422).
  - Test: Given cumulative 90 of 100, when posting 20, then 422 CUMULATIVE_EXCEEDED; duplicate scope-month then 409.
  - If wrong: Over-reported progress leads to over-payment against measurements.
- [ ] **GAP-WORKS-EXECUTION-WORKID-07** (low, unverified-service-absent) `['POST /v1/works/execution/physical-complete', 'POST /v1/works/execution/close', 'GET /api/v1/works/execution/:workId/scopes', 'GET /api/v1/works/execution/:workId/issues']`
  - Q: Does close require physical-complete first with no open issues and 100% progress, is it idempotent, and is it role-restricted and audited?
  - Verify: Open close and physical-complete handlers; call close on a work with an open issue (expect 409/422) and twice in a row.
  - Test: Given open issue, when POST close, then 422 OPEN_ISSUES; repeat close after success returns same result with a single audit row.
  - If wrong: Works closed prematurely; irreversible closure without controls.
- [ ] **GAP-WORKS-HOME-06** (low, unverified-service-absent) `['GET /api/v1/works/dashboard']`
  - Q: Do GET /api/v1/works/dashboard enforce works reader role checks, input validation, canonical status enums and the documented response shape?
  - Verify: In works-service open the route/handler for GET /api/v1/works/dashboard and its schema; curl each endpoint as a role without works reader (expect 403), as a valid role with a bad body (expect 422 with field errors) and compare a 200 body to the row type in apps/web/src/app/(app)/works/_data/types.ts.
  - Test: Given a user lacking works reader, when calling GET /api/v1/works/dashboard, then 403 and no audit-visible change; given a valid user, then 200 with {data:[...]} matching types.ts.
  - If wrong: Unauthorised access or malformed data in works records; page renders blank/incorrect values.
- [ ] **GAP-WORKS-MASTERS-08** (low, unverified-service-absent) `['GET /api/v1/works/masters/:type?pageSize=100', 'POST /v1/works/masters/:type']`
  - Q: Does the service expose exactly the 17 master types listed in page.tsx/MasterCreateForm.tsx, with those schemas, and audit writes?
  - Verify: List routes registered under /v1/works/masters and compare the type enum and body schemas with the two web lists.
  - Test: Given each of the 17 types, when GET masters/:type, then 200; unknown type returns 404.
  - If wrong: Web lists types that 404 or misses new ones.
- [ ] **GAP-WORKS-ORDERS-06** (low, unverified-service-absent) `['GET /api/v1/works/work-orders']`
  - Q: Does work-orders return {data:[...]} with pagination (pageSize/total) and what is the default page size?
  - Verify: Open work-orders list handler; curl with no pageSize and with pageSize=1000.
  - Test: Given 250 orders, when GET without pageSize, then default page and meta.total returned.
  - If wrong: Silent truncation of work orders.
- [ ] **GAP-WORKS-PROPOSALS-06** (low, unverified-service-absent) `['GET /api/v1/works/proposals?pageSize=100']`
  - Q: Does the list return total and a stable status vocabulary, and honour pageSize beyond 100?
  - Verify: Open proposals list handler; check meta.total and status enum documented in consumer.
  - Test: Given 130 proposals, when GET pageSize=100, then meta.total=130.
  - If wrong: Proposals beyond 100 invisible.
- [ ] **GAP-WORKS-PROPOSALS-DETAIL-09** (low, unverified-service-absent) `['GET /api/v1/works/proposals/:id', 'POST /v1/works/proposals/:id/dao-finalize']`
  - Q: After a 202 from dao-finalize, does the consumer (proposal/consumer.ts) complete the transition, and are failures visible in status and audit?
  - Verify: Open the dao-finalize handler and queue consumer; post finalize, then poll GET proposals/:id until status changes; force a consumer error.
  - Test: Given finalize accepted, when consumer runs, then status becomes dao_finalized with audit; on failure status shows failed and can be retried.
  - If wrong: Proposals stuck pending while the UI says finalized.
- [ ] **GAP-WORKS-PROPOSALS-NEW-06** (low, unverified-service-absent) `['POST /v1/works/proposals']`
  - Q: Does POST proposals validate description length, category enum and cost cap, detect duplicates, and audit?
  - Verify: Open proposals create schema; curl with oversize description, invalid category and a duplicate payload.
  - Test: Given invalid category, when POST proposals, then 422 with field error; duplicate returns 409.
  - If wrong: Invalid or duplicate proposals enter approval flow.
- [ ] **GAP-WORKS-REPORTS-07** (low, unverified-service-absent) `['GET /api/v1/works/reports/summary', 'GET /api/v1/works/reports/status']`
  - Q: How are active and closed defined in reports/summary, and does divisionId filter by hierarchy (including child divisions)?
  - Verify: Open reports handlers; compare counts to DB for a division with children.
  - Test: Given parent division with child works, when GET summary?divisionId=parent, then counts include children.
  - If wrong: Report totals misstated for officers.
- [ ] **GAP-WORKS-TENDERS-06** (low, unverified-service-absent) `['GET /api/v1/works/tenders?pageSize=100 (apps/web/src/app/(app)/works/_data/loaders.ts:133)', 'GET /api/v1/works/tenders?pageSize=200 (apps/web/src/app/(app)/works/tenders/[id]/page.tsx:58)']`
  - Q: Does GET /works/tenders honour pageSize up to 200 (not silently clamped), return a total count and paging metadata, and expose the columns the list maps (mapTenderRow) so rows beyond 100 can be reached?
  - Verify: In works-service open the tenders list route/handler and its query schema: check pageSize max/default and whether page/cursor and total are returned. Then seed 150 tenders and call GET /api/v1/works/tenders?pageSize=100, ?pageSize=200 and ?pageSize=100&page=2 with a works-viewer token; expect 100, 150 and 50 rows and a total of 150.
  - Test: Given 150 tenders exist, when a viewer calls GET /works/tenders?pageSize=200, then 150 items are returned with total=150; when pageSize=500, then it is 400 or clamped with the max stated in the response meta.
  - If wrong: Tenders beyond the cap are invisible in the list and the stat cards (Total/Open/Closed) undercount, so a tender can be missed in pipeline monitoring.
- [ ] **GAP-WORKS-TENDERS-DETAIL-08** (low, unverified-service-absent) `['GET /api/v1/works/tenders/:id/quotations', 'POST /v1/works/tenders/quotation', 'POST /v1/works/tenders/award', 'POST /v1/works/tenders/award/:id/{level}-finalize']`
  - Q: What are the quotation/award status enums, how is deviation computed, are award and finalize role-restricted, and how does a client learn the queued award outcome?
  - Verify: Open tenders award handlers and consumer; award as unauthorised role (expect 403), award and poll until processed.
  - Test: Given quotation above estimate by 12%, when awarding, then deviation=12 and status transitions awarded; unauthorised then 403.
  - If wrong: Wrong contractor awarded or unauthorised award.
- [ ] **GAP-WORKS-TENDERS-NEW-06** (low, unverified-service-absent) `['POST /v1/works/tenders/pre-tender']`
  - Q: Does pre-tender require the work to exist and be TS-eligible, reject duplicate reference numbers, and audit?
  - Verify: Open pre-tender handler; post with unknown workId, non-TS work and repeated referenceNo.
  - Test: Given work without TS, when POST pre-tender, then 422 TS_REQUIRED; duplicate reference then 409.
  - If wrong: Tenders created without sanction.

## asset-service (22)

- [ ] **GAP-ASSETS-INSURANCE-02** (high, unverified-service-absent) `['GET /api/v1/assets/insurance/policies', 'GET /api/v1/assets/assets', 'GET /api/v1/assets/fleet/*', 'vs GET /api/v1/asset/*']`
  - Q: Which gateway prefix routes to asset-service: /api/v1/asset, /api/v1/assets, or both?
  - Verify: Open gateway route catalogue / asset-service route registration (fastify prefix); curl both /api/v1/asset/assets and /api/v1/assets/assets with a valid token and compare status.
  - Test: Given a valid token; when GET /api/v1/assets/assets and /api/v1/asset/assets; then both return 200 identical or the wrong one returns 404 (test pins the canonical prefix).
  - If wrong: Insurance and fleet pages empty in production (404 silently swallowed to empty list).
- [ ] **GAP-ASSETS-BULK-IMPORT-04** (medium, unverified-service-absent) `POST /api/v1/asset/bulk/import`
  - Q: Does bulk import require a reason/idempotency key, emit one audit event per batch (with row count and actor), and enforce maker-checker or role for GL-linked creation?
  - Verify: Open asset-service bulk import route; POST the same file twice with the same Idempotency-Key expecting no duplicates; check audit store and role guard.
  - Test: Given a 50-row CSV, when imported twice with the same key, then 50 assets exist and one audit event {actor,count} is recorded.
  - If wrong: Duplicate or unaudited asset creation corrupting the asset register and GL.
- [ ] **GAP-ASSETS-LEASES-04** (medium, unverified-service-absent) `['GET/POST /api/proxy/v1/asset/leases']`
  - Q: Which lease accounting standard (Ind AS 116 / GFR) does the leases module implement, and is IFRS 16 wording acceptable to the department's accounting policy?
  - Verify: Ask finance/accounting owner for the policy; open asset-service leases module for standard-specific fields (ROU asset, lease liability) and naming.
  - Test: Given department edition=govt; when GET leases UI copy is rendered; then no string contains 'IFRS 16' (snapshot test on page and hub tile).
  - If wrong: Non-compliant terminology in a government audit; confusion with Ind AS 116/GFR.
- [ ] **GAP-ASSETS-CONDEMNATION-08** (low, unverified-service-absent) `asset-service condemnation module command endpoints (modules/condemnation/routes.ts)`
  - Q: Do condemnation commands enforce maker-checker (survey vs approve by different users) and optimistic-version checks returning 409 on stale version?
  - Verify: Open services/asset-service/src/modules/condemnation/routes.ts; call approve with the creator's JWT expecting 403 and with a stale version expecting 409.
  - Test: Given a survey by user A, when A records approval, then 403; when version is stale, then 409.
  - If wrong: Asset disposal approved without segregation of duties; lost updates.
- [ ] **GAP-ASSETS-DASHBOARD-05** (low, unverified-service-absent) `GET /api/v1/asset/dashboard`
  - Q: How are taggedAssets and dueForDisposal computed (status filter, date basis, tenant scope, excluding disposed)?
  - Verify: Open the asset-service dashboard handler/query; compare counts against a seeded dataset.
  - Test: Given 10 assets (3 disposed, 2 past useful life), when GET dashboard, then taggedAssets=7 and dueForDisposal=2.
  - If wrong: Dashboard KPIs misreport register size and disposal backlog.
- [ ] **GAP-ASSETS-DEPRECIATION-06** (low, unverified-service-absent) `['POST /api/proxy/v1/asset/depreciation/run (gateway /api/v1/asset/depreciation/run)', 'event finance.gl.post (queue)']`
  - Q: Is depreciation run idempotent per (book, period), locked against concurrent runs, and is a reversal path defined for a posted run?
  - Verify: Open asset-service depreciation module handler for POST /depreciation/run; check unique key (book_id, period), advisory/row lock, and the finance.gl.post outbox emit; in finance-service check consumer dedupes on event id. Call run twice for same period and compare.
  - Test: Given a run posted for book B period 2026-08; when POST /depreciation/run is repeated for the same book/period concurrently; then exactly one journal is posted, second returns 409 or the same run id, and a reversal endpoint produces a contra journal.
  - If wrong: Double depreciation posted to GL; misstated asset register and financial statements.
- [ ] **GAP-ASSETS-DETAIL-10** (low, unverified-service-absent) `['POST /api/proxy/v1/asset/assets/{id}/transfer', 'POST /api/proxy/v1/asset/assets/{id}/request-disposal', 'POST /api/proxy/v1/asset/assets/{id}/dispose', 'POST /api/proxy/v1/asset/assets/{id}/inter-org-transfer', 'POST /api/proxy/v1/assets/disposals/{id}/submit-approval']`
  - Q: Do transfer and dispose enforce maker-checker (requester cannot approve), impairment ceilings (<= carrying value) and GL posting on disposal?
  - Verify: Open services/asset-service/src/modules/enterprise/routes.ts (cited at AssetFinancialActions.tsx:4); check role guards on dispose vs request-disposal, requester!=approver rule, impairment amount validation, and gl.post emit. curl dispose as the same user who requested disposal.
  - Test: Given user U requested disposal of asset A; when U calls POST /dispose on A; then 403 (maker-checker) and no GL event; when impairment > carrying value then 422.
  - If wrong: Fraudulent single-person disposal of public assets; overstated impairment; missing GL entries.
- [ ] **GAP-ASSETS-FIXED-ASSETS-06** (low, unverified-service-absent) `['GET /api/v1/asset/assets?type=fixed']`
  - Q: Does the list endpoint apply a maximum page size and deterministic default sort, and is the type=fixed filter honoured?
  - Verify: Open asset-service assets list handler; check limit default/max, ORDER BY, type filter. curl '/assets?type=fixed' with >500 seeded rows and inspect count and order.
  - Test: Given 600 fixed assets; when GET /assets?type=fixed; then response is capped at documented max with stable order (asset_code asc) and returns pagination meta/next cursor.
  - If wrong: Silent truncation shows an incomplete register; audit/reporting mismatch.
- [ ] **GAP-ASSETS-FLEET-DEVICES-07** (low, unverified-service-absent) `['GET /api/v1/assets/fleet/devices']`
  - Q: Does the fleet-devices module exist under this prefix and expose telemetry-consumer status (last-seen, connected) fields the page infers?
  - Verify: Open asset-service src/modules/fleet-devices routes; confirm GET /fleet/devices path, response fields (lastSeenAt, status) and that the telemetry consumer updates them. curl through gateway with fleet role.
  - Test: Given a device with no telemetry for 24h; when GET /fleet/devices; then status = 'offline' and lastSeenAt is populated.
  - If wrong: Stale or fabricated device status; fleet ops decisions on wrong data.
- [ ] **GAP-ASSETS-FLEET-MAINTENANCE-07** (low, unverified-service-absent) `['GET /api/v1/assets/fleet/maintenance']`
  - Q: Do fleet maintenance schedules return next-due date/odometer semantics (date OR km, whichever first) as the page infers?
  - Verify: Open asset-service fleet maintenance handler and schema; check dueDate, dueOdometer, status enum, and overdue computation. Seed schedule and GET.
  - Test: Given a schedule due 2026-09-01 or 10000 km; when km exceeded before date; then status='due' and row sorted first.
  - If wrong: Missed vehicle servicing; safety and warranty risk.
- [ ] **GAP-ASSETS-FLEET-VEHICLES-07** (low, unverified-service-absent) `['GET /api/v1/assets/fleet/vehicles', 'GPS/register endpoints (unnamed in page)']`
  - Q: What are the register and GPS response shapes and which roles may read vehicles and GPS positions?
  - Verify: Open asset-service fleet vehicles routes; list preHandler roles, response DTO. curl as reader and as fleet_admin; compare fields to VehicleRow in the page.
  - Test: Given role 'reader'; when GET /fleet/vehicles/{id}/gps; then 403; fleet_officer gets lat/lng/timestamp.
  - If wrong: Location data of officials' vehicles exposed to all users (privacy/DPDP).
- [ ] **GAP-ASSETS-INSURANCE-CLAIMS-07** (low, unverified-service-absent) `['POST /api/v1/assets/insurance/claims', 'GET /api/v1/assets/insurance/claims?limit=200']`
  - Q: Does POST claims reject with CLAIM_EXCEEDS_COVERAGE when claimed amount exceeds remaining sum insured, using this exact error code and a 422/409 status?
  - Verify: Open asset-service insurance module claim create handler; grep CLAIM_EXCEEDS_COVERAGE; verify remaining coverage = sumInsured - approved claims. POST claim above cover.
  - Test: Given policy sumInsured 100000 with 80000 claimed; when POST claim 30000; then 422 {code:'CLAIM_EXCEEDS_COVERAGE'}.
  - If wrong: Over-claims accepted against a policy; financial leakage.
- [ ] **GAP-ASSETS-INSURANCE-DETAIL-05** (low, unverified-service-absent) `['GET /api/v1/assets/insurance/claims?policyId={id}', 'GET /api/v1/assets/insurance/policies/{id}']`
  - Q: Does the claims list honour the policyId query filter server-side (and reject unknown policy for tenant)?
  - Verify: Open claims list handler in insurance module; confirm policyId in zod query schema and WHERE clause. curl with policyId of policy A and verify no claims of policy B.
  - Test: Given claims for policies A and B; when GET claims?policyId=A; then only A's claims returned; unknown filter param does not return everything.
  - If wrong: Policy page shows other policies' claims; wrong exposure figures.
- [ ] **GAP-ASSETS-LEASES-07** (low, unverified-service-absent) `['GET/POST /api/proxy/v1/asset/leases']`
  - Q: On lease creation does the service post ROU asset and lease liability and generate an amortisation schedule with correct discounting?
  - Verify: Open asset-service leases handler; find schedule generation and gl.post emit; POST a 12-month lease and inspect schedule rows and outbox events.
  - Test: Given lease 12 x 10000 at 8% IBR; when created; then liability = PV of payments, 12 schedule rows sum to total interest+principal, one ROU/liability journal emitted.
  - If wrong: Incorrect lease liabilities in financials.
- [ ] **GAP-ASSETS-LIST-06** (low, unverified-service-absent) `['GET /api/v1/asset/assets']`
  - Q: What is the default and maximum page size of GET /assets and does it return pagination metadata?
  - Verify: Open asset-service assets list handler and query schema; curl with no limit and limit=10000.
  - Test: Given 500 assets; when GET /assets without limit; then response length equals documented default and meta.total=500; limit>max is clamped or 400.
  - If wrong: Silent truncation of asset list.
- [ ] **GAP-ASSETS-LOCATIONS-06** (low, unverified-service-absent) `['GET/POST /api/proxy/v1/asset/locations']`
  - Q: Are location codes unique per tenant and are reads/writes scoped by tenant from the JWT?
  - Verify: Open locations module repo and migration for unique(tenant_id, code) and tenant filter in queries; POST duplicate code, and GET as another tenant.
  - Test: Given location L1 in tenant T1; when T1 POSTs L1 again then 409; when T2 GETs locations then L1 absent.
  - If wrong: Cross-tenant data leak or duplicate locations corrupting asset placement.
- [ ] **GAP-ASSETS-MAINTENANCE-04** (low, unverified-service-absent) `['GET /api/v1/asset/maintenance', 'GET /api/v1/asset/assets/{id}/maintenance', 'POST /api/proxy/v1/asset/work-orders']`
  - Q: Do the queue endpoint and per-asset history return the same records/shape (same table, same status enum)?
  - Verify: Open asset-service maintenance routes; confirm both handlers query the same repo and share DTO; create a WO and GET both.
  - Test: Given a new work order for asset A; when GET /maintenance and GET /assets/A/maintenance; then the order appears in both with identical status and dates.
  - If wrong: Queue and asset history disagree; maintenance backlog misreported.
- [ ] **GAP-ASSETS-MAINTENANCE-NEW-06** (low, unverified-service-absent) `['POST /api/proxy/v1/asset/work-orders']`
  - Q: Does work-order creation write an audit record, return 202 vs 201 as page.tsx:64 assumes, and reject duplicate open orders for the same asset and type?
  - Verify: Open work-orders route; check status code returned, audit insert (audit_log/emit), duplicate guard. POST twice with same payload.
  - Test: Given open WO for asset A type 'repair'; when POST identical WO; then 409 and one audit entry exists for the first.
  - If wrong: Duplicate work orders, no audit trail on maintenance spend.
- [ ] **GAP-ASSETS-PROJECTS-09** (low, unverified-service-absent) `['GET /api/v1/asset/projects/auc', 'capitalize action (enterprise routes)']`
  - Q: Does capitalising an AUC project post the GL entry, honour dual-book start date and write an audit event, and is it maker-checker gated?
  - Verify: Open services/asset-service/src/modules/enterprise/routes.ts capitalize handler; check gl.post emit, book start date validation, audit insert, role guard.
  - Test: Given AUC project with 500000 accumulated; when capitalize by non-approver then 403; by approver then one journal and audit row, project status='capitalized', second call 409.
  - If wrong: Wrong capitalisation date/amount and unaudited capital postings.
- [ ] **GAP-ASSETS-REGISTER-08** (low, unverified-service-absent) `['POST /api/proxy/v1/asset/assets']`
  - Q: Does asset create validate required fields and enums, reject duplicate asset codes per tenant, and write an audit record?
  - Verify: Open asset create handler and schema; POST missing fields, invalid category enum and duplicate code.
  - Test: Given asset code A-001 exists; when POST same code then 409; invalid category then 422 with field errors; audit row written on success.
  - If wrong: Duplicate/invalid assets in the register; no trail.
- [ ] **GAP-ASSETS-SCAN-06** (low, unverified-service-absent) `['GET /api/proxy/v1/asset/scan/{barcode}']`
  - Q: Is barcode unique per tenant, is lookup tenant-scoped, and is each scan logged?
  - Verify: Open scan route; check unique(tenant_id, barcode), WHERE tenant, and scan-log insert. Scan barcode of another tenant.
  - Test: Given barcode X in tenant T1; when T2 scans X then 404; when T1 scans then 200 and a scan_log row.
  - If wrong: Cross-tenant asset disclosure; no physical-verification evidence.
- [ ] **GAP-ASSETS-VERIFICATION-07** (low, unverified-service-absent) `['GET/POST /api/proxy/v1/asset/verifications']`
  - Q: Who may open/close verification sessions, is lifecycle (open->closed) enforced and are transitions audited?
  - Verify: Open verifications routes; check role guards, status transitions and audit insert. Close a closed session; call as reader.
  - Test: Given a closed session; when POST verification on it then 409; reader role POST then 403.
  - If wrong: Tampering with completed physical verification records.

## payroll-service (20)

- [ ] **GAP-PAYROLL-CORRECTIONS-01** (high, unverified-service-absent) `['GET /api/v1/payroll/corrections', 'POST v1/payroll/corrections']`
  - Q: Is there an approve/reject endpoint for corrections requiring a different user from the creator, with audit?
  - Verify: Grep payroll-service corrections routes for approve/reject; curl approve as creator expecting 403.
  - Test: Given pending correction by user A, when A approves, then 403; user B approves gives 200 and audit.
  - If wrong: Retro pay changes without maker-checker.
- [ ] **GAP-PAYROLL-OFF-CYCLE-01** (high, unverified-service-absent) `['POST v1/payroll/off-cycle', 'POST v1/payroll/off-cycle/:id/process']`
  - Q: Does process reject when approval_status is not approved or when caller is the creator?
  - Verify: Open off-cycle process handler; curl process on a draft/pending run expecting 409/403.
  - Test: Given draft run with approval_status=pending, when POST process, then 409; creator process gives 403.
  - If wrong: Unapproved bonus payouts.
- [ ] **GAP-PAYROLL-RETURNS-04** (high, unverified-service-absent) `['POST /api/proxy/v1/payroll/statutory/form24q/force-file']`
  - Q: Does force-file require a payroll/finance approver role and mandatory reason and audit?
  - Verify: Open force-file handler; curl as employee expecting 403.
  - Test: Given employee token, when POST force-file, then 403; approver with reason gives 200 and audit force_file_24q.
  - If wrong: TRACES reconciliation gate bypassed by any user.
- [ ] **GAP-PAYROLL-SLIPS-DETAIL-02** (high, unverified-service-absent) `['GET /api/v1/payroll/slips/:id']`
  - Q: Does slip response give earnings[].amount, deductionItems[].amount, statutory.* in paise, or components[].amountMinor?
  - Verify: Open slips DTO in payroll-service; curl one slip and inspect keys and units.
  - Test: Given basic 50000 rupees, when GET slip, then documented key carries 5000000 paise; contract test compares detail and printable page fields.
  - If wrong: Wrong salary figures on payslips.
- [ ] **GAP-PAYROLL-STATUTORY-CHALLANS-01** (high, unverified-service-absent) `['POST v1/payroll/statutory/challans']`
  - Q: Does challan ingest require payroll/finance role and audit, with duplicate CIN/BSR rejection?
  - Verify: Open challans ingest handler; curl as employee expecting 403.
  - Test: Given employee token, when POST challan, then 403; duplicate BSR+serial gives 409.
  - If wrong: Forged challans corrupt 24Q reconciliation.
- [ ] **GAP-PAYROLL-STATUTORY-ESI-01** (high, unverified-service-absent) `['GET /api/v1/payroll/statutory/esi']`
  - Q: GET statutory/esi must reject roles employee and manager (allow only payroll_admin, payroll_officer, super_admin) and scope rows to the caller's tenant.
  - Verify: Open the payroll-service route file for GET /v1/payroll/statutory/esi and check the preHandler/requireRoles list; then curl it with a bearer token for role employee and for manager expecting 403, and for payroll_admin expecting 200.
  - Test: Given a valid employee-role JWT, when GET /v1/payroll/statutory/esi, then 403 and no ledger rows; given payroll_officer, then 200 with tenant-scoped rows.
  - If wrong: Any employee/manager can read every employee's ESI wages and IP numbers (personal data breach, DPDP).
- [ ] **GAP-PAYROLL-STATUTORY-GPF-03** (high, unverified-service-absent) `['GET /api/v1/payroll/statutory/gpf']`
  - Q: GET statutory/gpf must be limited to HR/finance/payroll roles, matching hrms GPF routes (gpf/routes.ts:24,55), and reject employee/manager.
  - Verify: Open the payroll-service route file for GET /v1/payroll/statutory/gpf and check the preHandler/requireRoles list; then curl it with a bearer token for role employee and for manager expecting 403, and for payroll_admin expecting 200. Compare the role list with services/hrms-service/src/modules/gpf/routes.ts:24,55.
  - Test: Given employee JWT, when GET gpf, then 403; given payroll_officer, then 200.
  - If wrong: Every employee's GPF subscription amounts visible to all staff.
- [ ] **GAP-PAYROLL-STATUTORY-GRATUITY-01** (high, unverified-service-absent) `['GET /api/v1/payroll/statutory/gratuity', '(calculator is client-side: GratuityCalculator.tsx)']`
  - Q: Gratuity/DCRG rule set (formula, 5-year gate, cap) must be selected per edition/entitlement (Payment of Gratuity Act for PSU/Small Office; CCS Pension DCRG for Govt Department) rather than hard-coded.
  - Verify: Open payroll-service gratuity computation (and hrms pension/engine.ts for DCRG) and check whether the rule is read from tenant entitlement/config; ask the product owner which rule applies to Govt Department. Compare the register's computed amount vs GratuityCalculator for a sample 22-year employee.
  - Test: Given a Govt Department tenant and 22 completed years, when gratuity is computed, then DCRG uses the pension-rule formula and ceiling, not 15/26 x years capped at 20,00,000.
  - If wrong: Wrong legal entitlement shown/paid to retiring state employees; audit objection.
- [ ] **GAP-PAYROLL-STATUTORY-GRATUITY-02** (high, unverified-service-absent) `['GET /api/v1/payroll/statutory/gratuity']`
  - Q: GET statutory/gratuity must reject employee and manager and allow only payroll/HR-finance roles.
  - Verify: Open the payroll-service route file for GET /v1/payroll/statutory/gratuity and check the preHandler/requireRoles list; then curl it with a bearer token for role employee and for manager expecting 403, and for payroll_admin expecting 200.
  - Test: Given manager JWT, when GET gratuity, then 403.
  - If wrong: Separation payouts of all employees exposed to all staff.
- [ ] **GAP-PAYROLL-STATUTORY-LWF-01** (high, unverified-service-absent) `['GET /api/v1/payroll/statutory/state-rules', 'POST /api/v1/payroll/statutory/state-rules']`
  - Q: POST statutory/state-rules (LWF/PT rule change) must be limited to payroll_admin/super_admin and emit an audit event; employee/manager get 403.
  - Verify: Open the payroll-service route file for POST /v1/payroll/statutory/state-rules and check the preHandler/requireRoles list; then curl it with a bearer token for role employee and for manager expecting 403, and for payroll_admin expecting 200. Also check the audit emission (CLAUDE.md rule 8).
  - Test: Given manager JWT, when POST state-rules with lwfEmployee, then 403 and no audit event; given payroll_admin, then 200 and one audit event with before/after.
  - If wrong: Any user could change statutory deduction rates for all employees.
- [ ] **GAP-PAYROLL-STATUTORY-LWF-02** (high, unverified-service-absent) `['POST /api/v1/payroll/statutory/state-rules']`
  - Q: POST state-rules with lwfEmployee/lwfEmployer only must preserve the existing frequency (merge, not overwrite/null) and the GET must return frequency.
  - Verify: Open the state-rules upsert in payroll-service; check whether omitted fields are preserved. Test: seed a state with frequency=half-yearly, POST without frequency, GET and compare.
  - Test: Given state MH frequency=half-yearly, when POST {stateCode:'MH',lwfEmployee:2500,lwfEmployer:7500}, then GET shows frequency unchanged.
  - If wrong: Frequency silently reset, wrong LWF deduction cadence.
- [ ] **GAP-PAYROLL-STATUTORY-PERQUISITE-02** (high, unverified-service-absent) `['GET /api/v1/payroll/statutory/form12ba?employeeId=&fy=', 'POST /api/v1/payroll/statutory/perquisite-components']`
  - Q: form12ba lookup and perquisite-components POST must be restricted to payroll/HR roles (an employee may read only their own employeeId), and lookups of others should be audited.
  - Verify: Open the payroll-service route file for GET form12ba and POST perquisite-components and check the preHandler/requireRoles list; then curl it with a bearer token for role employee and for manager expecting 403, and for payroll_admin expecting 200. Also call form12ba with employee JWT and another employee's id.
  - Test: Given employee JWT for E1, when GET form12ba?employeeId=E2, then 403; for own id 200; POST perquisite-components as employee, then 403.
  - If wrong: Exposure of another employee's PAN and perquisites; unauthorised tax-perquisite edits.
- [ ] **GAP-PAYROLL-STATUTORY-PF-01** (high, unverified-service-absent) `['GET /api/v1/payroll/statutory/pf', 'GET /api/v1/payroll/statutory/ecr?month=']`
  - Q: GET pf and GET ecr must reject employee/manager; ECR only for payroll_admin/payroll_officer.
  - Verify: Open the payroll-service route file for GET /v1/payroll/statutory/pf and /ecr and check the preHandler/requireRoles list; then curl it with a bearer token for role employee and for manager expecting 403, and for payroll_admin expecting 200.
  - Test: Given employee JWT, when GET ecr?month=2026-08, then 403 and no file body.
  - If wrong: Bulk member wage file downloadable by any user.
- [ ] **GAP-PAYROLL-STATUTORY-PT-01** (high, unverified-service-absent) `['POST /api/v1/payroll/statutory/state-rules']`
  - Q: POST state-rules with ptSlabs must be limited to payroll_admin/super_admin.
  - Verify: Open the payroll-service route file for POST /v1/payroll/statutory/state-rules and check the preHandler/requireRoles list; then curl it with a bearer token for role employee and for manager expecting 403, and for payroll_admin expecting 200.
  - Test: Given employee JWT, when POST ptSlabs, then 403; given payroll_admin, 200.
  - If wrong: Unauthorised change of professional-tax slabs.
- [ ] **GAP-PAYROLL-STATUTORY-PT-03** (high, unverified-service-absent) `['POST /api/v1/payroll/statutory/state-rules']`
  - Q: POSTing ptSlabs with one element must upsert/append that slab and never delete the state's other slabs, and overlapping ranges must be rejected by zod/service validation.
  - Verify: Open the state-rules handler/repo; seed 3 slabs for a state, POST one new slab, then GET and count. Also POST an overlapping range.
  - Test: Given state KA with 3 slabs, when POST one non-overlapping slab, then GET returns 4; when overlapping, then 422.
  - If wrong: Silent deletion of a state's tax slabs and wrong PT deductions.
- [ ] **GAP-PAYROLL-RETURNS-06** (medium, unverified-service-absent) `['GET statutory/form24q', 'GET statutory/form26q', 'POST statutory/form24q/force-file']`
  - Q: Do all return endpoints use one money unit (paise integers) with consistent types?
  - Verify: Compare DTOs across payroll-service returns handlers; curl each and inspect amount types.
  - Test: Given TDS 35000 rupees, when GET 24Q/26Q/force-file, then all report 3500000 paise as numbers.
  - If wrong: 100x errors in statutory tax figures.
- [ ] **GAP-PAYROLL-STATUTORY-PF-02** (medium, unverified-service-absent) `['GET /api/v1/payroll/statutory/ecr?month=']`
  - Q: Every ECR generation must emit an audit event (actor, month, record count) even though it is a GET; also a GET that generates a file should be idempotent and side-effect free.
  - Verify: Open the ecr handler; grep for publishAudit/@civitasone/events. Call ecr twice and check the audit stream.
  - Test: Given payroll_officer, when GET ecr?month=..., then exactly one audit event export.ecr is emitted with actor and row count.
  - If wrong: Untraceable bulk export of personal data (DPDP/CERT-In).
- [ ] **GAP-PAYROLL-STATUTORY-CHALLANS-06** (low, unverified-service-absent) `['GET statutory/challans', 'GET statutory/reconcile', 'POST statutory/challans']`
  - Q: What are the reconcile status enum values and error codes returned for failed saves?
  - Verify: Open reconcile handler enums and error map; curl invalid POST.
  - Test: Given invalid challan, when POST, then 422 with code and field; reconcile status in documented enum.
  - If wrong: Generic errors; unmapped status labels.
- [ ] **GAP-PAYROLL-STATUTORY-ESI-06** (low, unverified-service-absent) `['GET /api/v1/payroll/statutory/esi']`
  - Q: The esi handler must filter by JWT tenantId (never a client param) and mask or omit fields such as ESIC IP number/Aadhaar for roles without the PII permission.
  - Verify: Open the esi handler and its repo query in payroll-service; confirm where tenantId comes from and which columns are selected. Then call with tenant A token and confirm no tenant B employee ids appear.
  - Test: Given rows for tenants A and B, when tenant A calls GET esi, then only A rows returned and response omits unmasked identifiers.
  - If wrong: Cross-tenant leak or unmasked PII in a statutory ledger.
- [ ] **GAP-PAYROLL-STATUTORY-GRATUITY-06** (low, unverified-service-absent) `['GET /api/v1/payroll/statutory/gratuity']`
  - Q: Register row status must be a closed enum (computed|settled|paid|...) and rows should carry employee display name, not only employeeId.
  - Verify: Open the gratuity schema/zod response in payroll-service; list the status enum values and whether employeeName is returned. Compare with StatusPill map in ui-kit.
  - Test: Given a gratuity row of each status, when GET gratuity, then status is in the documented enum and StatusPill renders a non-fallback tone for every value.
  - If wrong: Unmapped status shows as generic info; users see raw ids.

## crm-service (16)

- [ ] **GAP-CRM-LINKED-ACCOUNTS-01** (high, unverified-service-absent) `['POST /v1/crm/linked-accounts', 'DELETE /v1/crm/linked-accounts/:id']`
  - Q: Does the server verify mailbox ownership via OAuth/consent before activating a linked account, tying it to the caller only?
  - Verify: POST provider+email for a mailbox not owned by the caller; inspect status and sync eligibility.
  - Test: Given caller A registers B's email, when POST, then stays pending and never syncs without OAuth consent; consent recorded.
  - If wrong: Mailbox metadata of others ingested; DPDP breach; high.
- [ ] **GAP-CRM-OPPORTUNITIES-01** (high, unverified-service-absent) `['PATCH /v1/crm/deals/:id/stage', 'POST /v1/crm/deals/:id/close']`
  - Q: Does the stage endpoint reject terminal stages (Won/Lost) so closing must go through /close with outcome and reason?
  - Verify: PATCH stage to a won-type stage.
  - Test: Given open deal, when PATCH stage to Won, then 422 USE_CLOSE_ENDPOINT.
  - If wrong: Deals closed without reason/competitor; corrupts win-loss analytics; high.
- [ ] **GAP-CRM-PIPELINES-01** (high, unverified-service-absent) `['DELETE /v1/crm/pipelines/:id', 'PUT /v1/crm/pipelines/:id']`
  - Q: Does delete or stage removal return 409 when deals reference the pipeline/stage instead of orphaning them?
  - Verify: DELETE a pipeline with open deals; PUT removing a populated stage.
  - Test: Given pipeline with 5 deals, when DELETE, then 409 with count; PUT dropping populated stage gives 409.
  - If wrong: Orphaned deals vanish from boards; high.
- [ ] **GAP-CRM-RTI-NEW-02** (high, unverified-service-absent) `['POST /v1/crm/rti']`
  - Q: Does POST /v1/crm/rti accept a receivedDate (and mode) and compute the 30-day dueDate from it, defaulting to server now only when omitted?
  - Verify: Open the rti create zod schema and handler in crm-service; POST with receivedDate 5 days ago and check dueDate = receivedDate + 30d.
  - Test: Given receivedDate=today-5 when RTI is created then dueDate=today+25 and receivedDate is persisted and audited; a future receivedDate returns 422.
  - If wrong: Statutory RTI deadlines computed from the wrong start date; missed deadlines and penalties.
- [ ] **GAP-CRM-ASSIGNMENT-DIRECTORY-04** (medium, unverified-service-absent) `['DELETE /v1/crm/{assignment-queues|territories|partners|branches}/:id', 'GET /v1/crm/assignment-rules']`
  - Q: Does DELETE of a referenced queue/territory/partner/branch return 409 or cascade, instead of leaving dangling rule/lead references?
  - Verify: DELETE a queue referenced by an assignment rule and by a lead.
  - Test: Given queue used by a rule, when DELETE, then 409 IN_USE listing references.
  - If wrong: Orphaned leads never assigned; medium.
- [ ] **GAP-CRM-DEALS-DETAIL-04** (medium, unverified-service-absent) `['POST /v1/crm/deals/:id/close']`
  - Q: Which roles may close deals and does close require outcome and reason, returning 403 otherwise?
  - Verify: Open close route guard; curl as read-only sales rep.
  - Test: Given rep without close permission, when POST close, then 403; without reason, 400.
  - If wrong: Unauthorised revenue recognition; medium.
- [ ] **GAP-CRM-DOCUMENT-TYPES-01** (medium, unverified-service-absent) `['PUT /v1/crm/document-types/:id', 'POST /v1/crm/document-types']`
  - Q: Is code immutable once documents reference the type (409 or ignored) so documents are not orphaned?
  - Verify: PUT changed code on a type with attached documents.
  - Test: Given type with 3 documents, when PUT new code, then 409 CODE_IMMUTABLE or documents keep working via id.
  - If wrong: Orphaned documents and broken checklist; medium.
- [ ] **GAP-CRM-PRICE-BOOKS-03** (medium, unverified-service-absent) `['GET /v1/crm/price-books/resolve', 'POST/PUT /v1/crm/price-books']`
  - Q: Is there a deterministic precedence, or a uniqueness check, when two enabled books share identical criteria?
  - Verify: Create two identical enabled books; call resolve.
  - Test: Given two books with identical criteria, when resolve, then documented deterministic winner (priority then newest) or save rejects with 409.
  - If wrong: Non-deterministic quote prices; medium.
- [ ] **GAP-CRM-QUALIFICATION-FRAMEWORKS-02** (medium, unverified-service-absent) `['PATCH /v1/crm/qualification-frameworks/:id', 'POST /v1/crm/qualification-frameworks', 'POST /v1/crm/leads/:id/qualify']`
  - Q: Does PATCH qualification-frameworks/:id require and check the row `version` (409 on stale) and does it reject or soft-retire removed question ids that leads already answered?
  - Verify: In crm-service open the qualification-frameworks route/handler; confirm zod body carries version and repo update uses WHERE version=:v. Then PATCH twice with the same version and expect 409 on the second; PATCH removing a question id that has a lead answer and expect 409/soft-retire, not silent delete.
  - Test: Given framework v1 with question Q1 answered on lead L1, when PATCH removes Q1 then Q1 is retained as retired (or 409) and L1's answer still resolves; when two PATCHes send version 1 the second returns 409.
  - If wrong: Silent lost update of a shared framework and orphaned lead qualification answers, corrupting lead scores.
- [ ] **GAP-CRM-QUOTATIONS-05** (medium, unverified-service-absent) `['POST /v1/crm/quotations', 'POST /v1/crm/quotations/:id/new-version', 'GET /v1/crm/price-books']`
  - Q: Does POST/new-version compare each line unitPrice/discount to the price-book price and require an approval (or reject) when it is below the allowed discount threshold?
  - Verify: Open the quotations create handler in crm-service; look for a discount-limit/approval check. curl POST /v1/crm/quotations with a line unitPrice below price-book price as a sales role and expect 422 or a pending-approval status.
  - Test: Given price-book price 1000 and max discount 10%, when a line is posted at 500 by a sales user then the API returns 422/approval_required and no sent quotation is created.
  - If wrong: Unauthorised discounting and revenue leakage with no approval trail.
- [ ] **GAP-CRM-SERVICE-REQUESTS-DETAIL-04** (medium, unverified-service-absent) `['PATCH /v1/crm/service-requests/:id/status']`
  - Q: When status becomes resolved, does the service publish a notification event to the citizen (email/SMS) and is a failure surfaced?
  - Verify: Open the status handler in crm-service; confirm an event/notification emit on resolved. Call PATCH status=resolved and check the notification-service outbox for a message to the request's citizenEmail/phone.
  - Test: Given a request with citizenPhone, when status is set to resolved then one notification event is emitted referencing the request id; with no contact none is sent and response says so.
  - If wrong: Citizen told they were notified when they were not; grievance-handling trust issue.
- [ ] **GAP-CRM-SERVICE-REQUESTS-NEW-03** (medium, unverified-service-absent) `['POST /v1/crm/service-requests']`
  - Q: Does the create handler derive dueDate/SLA class from serviceType and priority server-side, and are channel/dueDate accepted in the schema?
  - Verify: Open the service-request create schema/handler in crm-service; POST without dueDate and inspect the response dueDate and how it is calculated.
  - Test: Given serviceType with 5-day SLA, when created with priority=high then response dueDate equals created+SLA and is never null.
  - If wrong: Requests without due dates escape SLA tracking and breach reports.
- [ ] **GAP-CRM-VOICE-OF-CUSTOMER-04** (medium, unverified-service-absent) `['GET /v1/crm/sentiment/summary']`
  - Q: Is averageScore in the sentiment summary on a 0-100 scale or a signed -100..+100 scale?
  - Verify: Open the sentiment summary handler/schema in crm-service (and @civitasone/types CRMVocSummary) and read the score range; call the endpoint on data with negative feedback and check the sign.
  - Test: Given only negative interactions when summary is fetched then averageScore is <0 if signed (or in 0-100 and thresholds rescaled), and the schema documents the range.
  - If wrong: Executives misread sentiment; wrong 'Mixed/Negative' bucket labels.
- [ ] **GAP-CRM-ACCOUNTS-05** (low, unverified-service-absent) `['PATCH /v1/crm/accounts/:id/parent', '(merge) MergeDialog uses client lib/crm/dataQuality mergeEntities']`
  - Q: Is account merge performed server-side with role gate, confirmation-worthy irreversibility handling and audit, rather than client only?
  - Verify: Read MergeDialog.tsx and dataQuality.mergeEntities; then search crm-service for a merge route.
  - Test: Given two duplicate accounts, when merge, then children/contacts re-parented, source tombstoned, audit row with actor.
  - If wrong: Irreversible data loss without trail; high.
- [ ] **GAP-CRM-DOCUMENTS-05** (low, unverified-service-absent) `['POST /v1/crm/documents/presign', 'POST /v1/crm/documents', 'GET /v1/crm/documents/:id/download']`
  - Q: Does the service quarantine infected files automatically and apply a 30-day rule as the copy states?
  - Verify: Open documents virus-scan consumer and retention job; upload EICAR test file.
  - Test: Given EICAR upload, when scan completes, then status=quarantined and download is 403; 30-day rule verified by config test.
  - If wrong: False security claim in UI; medium.
- [ ] **GAP-CRM-QUALIFICATION-FRAMEWORKS-05** (low, unverified-service-absent) `['DELETE /v1/crm/qualification-frameworks/:id']`
  - Q: Does the DELETE handler emit an audit event via @civitasone/events with actor, tenant and framework id (CLAUDE.md rule 8)?
  - Verify: Open the delete handler in crm-service and confirm an audit emit call; run DELETE with role X and check the audit stream/table for a matching event.
  - Test: Given an existing framework, when an authorised user DELETEs it then exactly one audit event (action=delete, entityId, actor) is published and the framework is no longer listed.
  - If wrong: Copy promises an audit trail that may not exist; compliance/audit-log gap.

## tenant-service (13)

- [ ] **GAP-ADMIN-ORG-01** (high, unverified-service-absent) `GET/POST/PATCH /api/v1/admin/org-hierarchy (via /api/proxy)`
  - Q: Does org-hierarchy POST/PATCH require tenant_admin (or higher), tenant-scope the unit, reject reparent cycles, and audit each change?
  - Verify: In tenant-service repo open the route file registering GET/POST/PATCH /api/v1/admin/org-hierarchy (via /api/proxy) and confirm a preHandler/requireRole guard; then curl it with a JWT of a plain tenant user (e.g. employee) and expect 403, with a super_admin JWT expect 200.
  - Test: Given a JWT with role=employee, when GET/PATCH GET/POST/PATCH /api/v1/admin/org-hierarchy (via /api/proxy), then 403 and no body data; given super_admin, then 200.
  - If wrong: Any signed-in user reads or changes platform-operator data (privilege escalation / cross-tenant exposure).
- [ ] **GAP-TENANT-HOME-01** (high, unverified-service-absent) `['GET /api/v1/tenant/usage', 'GET /api/v1/tenant/settings', 'GET /api/v1/tenant/consent/requests', 'GET /api/v1/tenant/org/migrations']`
  - Q: Does tenant-service authorise these endpoints by role (tenant admin/config role) and tenant scope, independent of the web gate? Also check that consent and migration data are limited to admin/DPO roles.
  - Verify: Open tenant-service route guards for /api/v1/tenant/usage, /api/v1/tenant/settings, /api/v1/tenant/consent/requests, /api/v1/tenant/org/migrations; call each with a token holding only a basic user role expecting 403.
  - Test: Given basic signed-in user; when GET /api/v1/tenant/usage; then 403; given tenant admin then 200 scoped to own tenantId.
  - If wrong: Any employee reads tenant governance, plans or configuration.
- [ ] **GAP-TENANT-SETTINGS-01** (high, unverified-service-absent) `['GET /api/v1/tenant/settings']`
  - Q: Is GET settings restricted to admin roles and does it redact secret-typed values (masked or omitted)?
  - Verify: Open the settings handler/DTO in tenant-service: role guard and secret flag/redaction; seed key smtp_password and GET as basic user and as admin.
  - Test: Given secret key; when GET settings as admin; then value is masked ('****'); as basic user then 403.
  - If wrong: Credentials/secrets exposed to every employee.
- [ ] **GAP-TENANT-CODE-LISTS-04** (medium, unverified-service-absent) `['GET /api/v1/tenant/code-lists']`
  - Q: Does tenant-service authorise these endpoints by role (tenant admin/config role) and tenant scope, independent of the web gate?
  - Verify: Open tenant-service route guards for /api/v1/tenant/code-lists; call each with a token holding only a basic user role expecting 403.
  - Test: Given basic signed-in user; when GET /api/v1/tenant/code-lists; then 403; given tenant admin then 200 scoped to own tenantId.
  - If wrong: Any employee reads tenant governance, plans or configuration.
- [ ] **GAP-TENANT-DATA-MIGRATION-04** (medium, unverified-service-absent) `['GET /api/v1/tenant/org/migrations']`
  - Q: Does tenant-service authorise these endpoints by role (tenant admin/config role) and tenant scope, independent of the web gate?
  - Verify: Open tenant-service route guards for /api/v1/tenant/org/migrations; call each with a token holding only a basic user role expecting 403.
  - Test: Given basic signed-in user; when GET /api/v1/tenant/org/migrations; then 403; given tenant admin then 200 scoped to own tenantId.
  - If wrong: Any employee reads tenant governance, plans or configuration.
- [ ] **GAP-TENANT-ORG-HIERARCHY-04** (medium, unverified-service-absent) `['GET /api/v1/tenant/org/hierarchy']`
  - Q: Does tenant-service authorise these endpoints by role (tenant admin/config role) and tenant scope, independent of the web gate?
  - Verify: Open tenant-service route guards for /api/v1/tenant/org/hierarchy; call each with a token holding only a basic user role expecting 403.
  - Test: Given basic signed-in user; when GET /api/v1/tenant/org/hierarchy; then 403; given tenant admin then 200 scoped to own tenantId.
  - If wrong: Any employee reads tenant governance, plans or configuration.
- [ ] **GAP-TENANT-OVERVIEW-05** (medium, unverified-service-absent) `['GET /api/v1/tenant/current']`
  - Q: Does tenant-service authorise these endpoints by role (tenant admin/config role) and tenant scope, independent of the web gate?
  - Verify: Open tenant-service route guards for /api/v1/tenant/current; call each with a token holding only a basic user role expecting 403.
  - Test: Given basic signed-in user; when GET /api/v1/tenant/current; then 403; given tenant admin then 200 scoped to own tenantId.
  - If wrong: Any employee reads tenant governance, plans or configuration.
- [ ] **GAP-TENANT-PLANS-04** (medium, unverified-service-absent) `['GET /api/v1/tenant/plans']`
  - Q: Does tenant-service authorise these endpoints by role (tenant admin/config role) and tenant scope, independent of the web gate?
  - Verify: Open tenant-service route guards for /api/v1/tenant/plans; call each with a token holding only a basic user role expecting 403.
  - Test: Given basic signed-in user; when GET /api/v1/tenant/plans; then 403; given tenant admin then 200 scoped to own tenantId.
  - If wrong: Any employee reads tenant governance, plans or configuration.
- [ ] **GAP-TENANT-POSITIONS-04** (medium, unverified-service-absent) `['GET /api/v1/tenant/positions']`
  - Q: Does tenant-service authorise these endpoints by role (tenant admin/config role) and tenant scope, independent of the web gate?
  - Verify: Open tenant-service route guards for /api/v1/tenant/positions; call each with a token holding only a basic user role expecting 403.
  - Test: Given basic signed-in user; when GET /api/v1/tenant/positions; then 403; given tenant admin then 200 scoped to own tenantId.
  - If wrong: Any employee reads tenant governance, plans or configuration.
- [ ] **GAP-TENANT-QUOTAS-05** (medium, unverified-service-absent) `['GET /api/v1/tenant/usage']`
  - Q: Does tenant-service authorise these endpoints by role (tenant admin/config role) and tenant scope, independent of the web gate?
  - Verify: Open tenant-service route guards for /api/v1/tenant/usage; call each with a token holding only a basic user role expecting 403.
  - Test: Given basic signed-in user; when GET /api/v1/tenant/usage; then 403; given tenant admin then 200 scoped to own tenantId.
  - If wrong: Any employee reads tenant governance, plans or configuration.
- [ ] **GAP-TENANT-STEWARDSHIP-04** (medium, unverified-service-absent) `['GET /api/v1/tenant/data-governance/domains']`
  - Q: Does tenant-service authorise these endpoints by role (tenant admin/config role) and tenant scope, independent of the web gate?
  - Verify: Open tenant-service route guards for /api/v1/tenant/data-governance/domains; call each with a token holding only a basic user role expecting 403.
  - Test: Given basic signed-in user; when GET /api/v1/tenant/data-governance/domains; then 403; given tenant admin then 200 scoped to own tenantId.
  - If wrong: Any employee reads tenant governance, plans or configuration.
- [ ] **GAP-TENANT-SUBSCRIPTIONS-04** (medium, unverified-service-absent) `['GET /api/v1/tenant/subscription/current']`
  - Q: Does tenant-service authorise these endpoints by role (tenant admin/config role) and tenant scope, independent of the web gate?
  - Verify: Open tenant-service route guards for /api/v1/tenant/subscription/current; call each with a token holding only a basic user role expecting 403.
  - Test: Given basic signed-in user; when GET /api/v1/tenant/subscription/current; then 403; given tenant admin then 200 scoped to own tenantId.
  - If wrong: Any employee reads tenant governance, plans or configuration.
- [ ] **GAP-TENANT-ADMIN-ORG-TYPE-05** (low, unverified-service-absent) `['PATCH /v1/tenants/:id with {settings:{orgType}} (org-type/page.tsx:55)']`
  - Q: Does PATCH /v1/tenants/:id validate orgType against a fixed enum, restrict to tenant_admin, and emit an audit event with old/new value?
  - Verify: Open tenant-service tenants route and zod schema; PATCH orgType='bogus' expecting 422; check audit emission.
  - Test: Given orgType='bogus', when PATCH, then 422; given valid change, then 200 and audit event orgType.changed with before/after.
  - If wrong: Edition/entitlement misconfiguration without an audit trail.

## audit-service (13)

- [ ] **GAP-PLATFORM-ADMIN-AUDIT-LOG-02** (high, unverified-service-absent) `['GET /api/v1/audit/events?tenantScoped=true']`
  - Q: GET audit/events must require an audit/admin role (tenant_admin, platform_admin, auditor), scope to the caller's tenant, and audit the read/export.
  - Verify: Open audit-service events route; check requireRoles and the tenantScoped handling. curl as employee expecting 403, as tenant_admin expecting tenant-only rows.
  - Test: Given employee JWT, when GET audit/events?tenantScoped=true, then 403; given tenant_admin, only own-tenant events.
  - If wrong: Every user sees actor, IP and role of all events (privacy, security intel).
- [ ] **GAP-AUDIT-CAG-07** (low, unverified-service-absent) `['GET /api/v1/audit/paras']`
  - Q: Does GET /audit/paras require an audit role, and does the payload match CagParaSummary (para no., status enum, amount)?
  - Verify: In the audit-service repo open the route file for these paths; check the preHandler role list, tenant filter, response DTO. curl as role 'reader' (expect 403) and as 'audit_officer' (expect 200).
  - Test: Given a user with only reader role; when calling GET /api/v1/audit/paras; then 403. Given audit_officer; then 200 with the documented shape.
  - If wrong: Sensitive audit findings visible to unauthorised roles.
- [ ] **GAP-AUDIT-COMPLIANCE-07** (low, unverified-service-absent) `['GET /api/v1/audit/compliance']`
  - Q: Does GET /audit/compliance restrict to audit roles and return the item shape/status enum the page maps?
  - Verify: In the audit-service repo open the route file for these paths; check the preHandler role list, tenant filter, response DTO. curl as role 'reader' (expect 403) and as 'audit_officer' (expect 200).
  - Test: Given a user with only reader role; when calling GET /api/v1/audit/compliance; then 403. Given audit_officer; then 200 with the documented shape.
  - If wrong: Sensitive audit findings visible to unauthorised roles.
- [ ] **GAP-AUDIT-DASHBOARD-06** (low, unverified-service-absent) `['GET /api/v1/audit/dashboard']`
  - Q: Does GET /audit/dashboard restrict to audit roles and return counts matching the AuditDashboard shape, scoped to the caller's tenant?
  - Verify: In the audit-service repo open the route file for these paths; check the preHandler role list, tenant filter, response DTO. curl as role 'reader' (expect 403) and as 'audit_officer' (expect 200).
  - Test: Given a user with only reader role; when calling GET /api/v1/audit/dashboard; then 403. Given audit_officer; then 200 with the documented shape.
  - If wrong: Sensitive audit findings visible to unauthorised roles.
- [ ] **GAP-AUDIT-EXPORTS-07** (low, unverified-service-absent) `['GET /api/v1/audit/exports', 'POST /api/proxy/audit/exports', 'GET /api/proxy/v1/audit/exports/{id}', 'GET .../{id}/verify', 'GET .../{id}/download?token=']`
  - Q: Are export create/verify/download role-gated, is the download token single-use/expiring, and is each export itself written to the audit log?
  - Verify: In the audit-service repo open the route file for these paths; check the preHandler role list, tenant filter, response DTO, and the audit-event insert on each mutation. curl as role 'reader' (expect 403) and as 'audit_officer' (expect 200).
  - Test: Given a user with only reader role; when calling GET /api/v1/audit/exports; then 403. Given audit_officer; then 200 with the documented shape; and a mutation writes exactly one audit_events row.
  - If wrong: Audit data or mutation exposed to unauthorised roles; tamper-evidence lost.
- [ ] **GAP-AUDIT-HOME-07** (low, unverified-service-absent) `['GET /api/audit/events']`
  - Q: Is GET /audit/events role- and tenant-scoped, and is the path /api/audit/events (no v1) routed by the gateway?
  - Verify: In the audit-service repo open the route file for these paths; check the preHandler role list, tenant filter, response DTO. curl as role 'reader' (expect 403) and as 'audit_officer' (expect 200).
  - Test: Given a user with only reader role; when calling GET /api/audit/events; then 403. Given audit_officer; then 200 with the documented shape.
  - If wrong: Sensitive audit findings visible to unauthorised roles.
- [ ] **GAP-AUDIT-INVESTIGATION-07** (low, unverified-service-absent) `['GET /api/v1/audit/investigations']`
  - Q: Is GET /audit/investigations restricted to vigilance/audit roles and matches InvestigationSummary shape?
  - Verify: In the audit-service repo open the route file for these paths; check the preHandler role list, tenant filter, response DTO. curl as role 'reader' (expect 403) and as 'audit_officer' (expect 200).
  - Test: Given a user with only reader role; when calling GET /api/v1/audit/investigations; then 403. Given audit_officer; then 200 with the documented shape.
  - If wrong: Sensitive audit findings visible to unauthorised roles.
- [ ] **GAP-AUDIT-OBSERVATIONS-07** (low, unverified-service-absent) `['GET /api/v1/audit/observations', 'POST /api/proxy/v1/audit/observations']`
  - Q: Does POST observations validate severity/status enums, restrict to audit_officer and write an audit event?
  - Verify: In the audit-service repo open the route file for these paths; check the preHandler role list, tenant filter, response DTO, and the audit-event insert on each mutation. curl as role 'reader' (expect 403) and as 'audit_officer' (expect 200).
  - Test: Given a user with only reader role; when calling GET /api/v1/audit/observations; then 403. Given audit_officer; then 200 with the documented shape; and a mutation writes exactly one audit_events row.
  - If wrong: Audit data or mutation exposed to unauthorised roles; tamper-evidence lost.
- [ ] **GAP-AUDIT-OBSERVATIONS-DETAIL-07** (low, unverified-service-absent) `['GET /api/v1/audit/observations/{id}', 'POST .../{id}/reply', 'POST .../{id}/draft-para']`
  - Q: Do reply and draft-para require audit/auditee roles respectively, write an audit event, and enforce observation status transitions?
  - Verify: In the audit-service repo open the route file for these paths; check the preHandler role list, tenant filter, response DTO, and the audit-event insert on each mutation. curl as role 'reader' (expect 403) and as 'audit_officer' (expect 200).
  - Test: Given a user with only reader role; when calling GET /api/v1/audit/observations/{id}; then 403. Given audit_officer; then 200 with the documented shape; and a mutation writes exactly one audit_events row.
  - If wrong: Audit data or mutation exposed to unauthorised roles; tamper-evidence lost.
- [ ] **GAP-AUDIT-PLAN-07** (low, unverified-service-absent) `['GET /api/v1/audit/plan', 'POST /api/proxy/v1/audit/plans']`
  - Q: Does POST plans validate dates/scope, restrict to audit_admin and record who created the plan?
  - Verify: In the audit-service repo open the route file for these paths; check the preHandler role list, tenant filter, response DTO, and the audit-event insert on each mutation. curl as role 'reader' (expect 403) and as 'audit_officer' (expect 200).
  - Test: Given a user with only reader role; when calling GET /api/v1/audit/plan; then 403. Given audit_officer; then 200 with the documented shape; and a mutation writes exactly one audit_events row.
  - If wrong: Audit data or mutation exposed to unauthorised roles; tamper-evidence lost.
- [ ] **GAP-AUDIT-RISK-REGISTER-07** (low, unverified-service-absent) `['GET /api/v1/audit/risks', 'POST /api/proxy/v1/audit/risks']`
  - Q: Does POST risks validate likelihood/impact enums, restrict to audit roles and log the mutation?
  - Verify: In the audit-service repo open the route file for these paths; check the preHandler role list, tenant filter, response DTO, and the audit-event insert on each mutation. curl as role 'reader' (expect 403) and as 'audit_officer' (expect 200).
  - Test: Given a user with only reader role; when calling GET /api/v1/audit/risks; then 403. Given audit_officer; then 200 with the documented shape; and a mutation writes exactly one audit_events row.
  - If wrong: Audit data or mutation exposed to unauthorised roles; tamper-evidence lost.
- [ ] **GAP-AUDIT-VIGILANCE-07** (low, unverified-service-absent) `['GET /api/v1/audit/vigilance']`
  - Q: Is GET /audit/vigilance restricted to vigilance roles with case data masked for others?
  - Verify: In the audit-service repo open the route file for these paths; check the preHandler role list, tenant filter, response DTO. curl as role 'reader' (expect 403) and as 'audit_officer' (expect 200).
  - Test: Given a user with only reader role; when calling GET /api/v1/audit/vigilance; then 403. Given audit_officer; then 200 with the documented shape.
  - If wrong: Sensitive audit findings visible to unauthorised roles.
- [ ] **GAP-TENANT-ADMIN-AUDIT-06** (low, unverified-service-absent) `['GET /api/v1/audit/events?tenantScoped=true']`
  - Q: Does the events endpoint paginate with a bounded limit and a cursor/offset and return total/hasMore?
  - Verify: Open audit-service events handler; check zod limit max and cursor; GET limit=100000 and with offset.
  - Test: Given 500 events; when GET limit=50; then 50 rows plus next cursor; limit>max returns 400 or clamps.
  - If wrong: Truncated audit view or heavy unbounded queries.

## inventory-service (13)

- [ ] **GAP-INVENTORY-CYCLE-COUNTS-DETAIL-02** (high, unverified-service-absent) `['GET /api/v1/inventory/cycle-counts/{id}', 'POST /api/v1/inventory/cycle-counts/{id}/approve', 'POST /api/v1/inventory/cycle-counts/{id}/reject']`
  - Q: POST approve/reject must be limited to an approver role (e.g. store_manager/inventory_admin), reject approval when actor equals the count's creator/counter (maker!=checker), enforce optimistic version (409 on mismatch), post the stock adjustment idempotently and emit an audit event.
  - Verify: In inventory-service open the cycle-counts approve handler and consumer; curl POST .../approve as the user who created the count (expect 403 MAKER_CHECKER), as a non-approver role (403), as a valid approver with stale version (409), then twice with valid version (second call no duplicate adjustment).
  - Test: Given cycle count created by user U with variance, when U POSTs approve then 403; when approver POSTs with current version then 202 and exactly one stock adjustment and one audit event; repeat call is idempotent.
  - If wrong: Single person can self-approve inventory write-offs (fraud/control failure); duplicate adjustments corrupt stock.
- [ ] **GAP-INVENTORY-GOODS-RETURNS-DETAIL-05** (medium, unverified-service-absent) `['GET /api/v1/inventory/goods-returns/{id}', 'POST /api/v1/inventory/goods-returns']`
  - Q: The goods-return record must persist and return the inspector identity (createdBy/inspectedBy) plus resolvable item/store/issue display fields, and creation must emit an audit event.
  - Verify: Open inventory-service goods-returns create handler and schema; POST a return as store_keeper then GET it and confirm createdBy/inspectedBy is set from the JWT (not the body) and item name/code, store name, issue number are included; check audit topic for a goods_return.created event.
  - Test: Given store_keeper U posts a goods return, when GET detail then inspectedBy=U and itemName, storeName, issueNo present, and one audit event exists.
  - If wrong: No accountability for who accepted returned stock; auditors cannot trace.
- [ ] **GAP-INVENTORY-BINS-04** (low, unverified-service-absent) `['GET /api/v1/inventory/bins?limit=200']`
  - Q: GET /v1/inventory/bins must require an inventory role, enforce tenant scoping, cap and honour limit (with cursor/hasMore) and return rows in a stable order.
  - Verify: In the inventory-service repo open the bins route handler; curl /api/v1/inventory/bins?limit=200 with a token holding an inventory role (expect 200 {data,pagination}), a token with no inventory role (expect 403), and a token from another tenant (expect only own rows / 404).
  - Test: Given tenant A rows and tenant B rows, when a role without inventory access GETs /api/v1/inventory/bins?limit=200 then 403; when store_keeper of A GETs then only A rows, limit honoured, hasMore true when more exist.
  - If wrong: Cross-tenant/unauthorised stock visibility or silently truncated lists cause wrong stock decisions.
- [ ] **GAP-INVENTORY-GOODS-RETURNS-04** (low, unverified-service-absent) `['GET /api/v1/inventory/goods-returns?limit=200']`
  - Q: GET /v1/inventory/goods-returns must require an inventory/store role, tenant-scope rows, honour limit with stable ordering and paginate beyond 200.
  - Verify: In the inventory-service repo open the goods-returns route handler; curl /api/v1/inventory/goods-returns?limit=200 with a token holding an inventory role (expect 200 {data,pagination}), a token with no inventory role (expect 403), and a token from another tenant (expect only own rows / 404).
  - Test: Given tenant A rows and tenant B rows, when a role without inventory access GETs /api/v1/inventory/goods-returns?limit=200 then 403; when store_keeper of A GETs then only A rows, limit honoured, hasMore true when more exist.
  - If wrong: Cross-tenant/unauthorised stock visibility or silently truncated lists cause wrong stock decisions.
- [ ] **GAP-INVENTORY-HOME-05** (low, unverified-service-absent) `['GET /api/v1/inventory/items/{id}/forecast?horizon=30', 'GET /api/v1/inventory/low-stock']`
  - Q: GET /v1/inventory/items/:id/forecast must document its model, return dailyForecast[] of length horizon with an 'available' flag and confidence, and low-stock must be ordered by proximity to reorder point so the page's first row is truly the nearest.
  - Verify: In inventory-service open the forecast handler; curl low-stock and forecast?horizon=30 as inventory role, assert dailyForecast.length==30, numbers >=0, confidence in [0,1]; assert low-stock ordering matches (onHand-reorderLevel) ascending.
  - Test: Given item with 90 days history, when GET forecast?horizon=30 then 200 with 30 non-negative numbers; for item with <N days history then available=false rather than fabricated series.
  - If wrong: Misleading demand chart drives wrong reorder decisions.
- [ ] **GAP-INVENTORY-ISSUES-04** (low, unverified-service-absent) `['GET /api/v1/inventory/ledger?limit=200']`
  - Q: GET /v1/inventory/ledger must require an inventory role, tenant-scope, honour limit with stable order (newest first) and expose a movement type filter so the Issues view is not silently truncated to 200 mixed rows.
  - Verify: In the inventory-service repo open the ledger route handler; curl /api/v1/inventory/ledger?limit=200 with a token holding an inventory role (expect 200 {data,pagination}), a token with no inventory role (expect 403), and a token from another tenant (expect only own rows / 404).
  - Test: Given tenant A rows and tenant B rows, when a role without inventory access GETs /api/v1/inventory/ledger?limit=200 then 403; when store_keeper of A GETs then only A rows, limit honoured, hasMore true when more exist.
  - If wrong: Cross-tenant/unauthorised stock visibility or silently truncated lists cause wrong stock decisions.
- [ ] **GAP-INVENTORY-ITEMS-04** (low, unverified-service-absent) `['GET /api/v1/inventory/items']`
  - Q: GET /v1/inventory/items must require an inventory role, tenant-scope rows and paginate (the web sends no limit, so the default page size and hasMore behaviour matter).
  - Verify: In the inventory-service repo open the items route handler; curl /api/v1/inventory/items with a token holding an inventory role (expect 200 {data,pagination}), a token with no inventory role (expect 403), and a token from another tenant (expect only own rows / 404).
  - Test: Given tenant A rows and tenant B rows, when a role without inventory access GETs /api/v1/inventory/items then 403; when store_keeper of A GETs then only A rows, limit honoured, hasMore true when more exist.
  - If wrong: Cross-tenant/unauthorised stock visibility or silently truncated lists cause wrong stock decisions.
- [ ] **GAP-INVENTORY-LOW-STOCK-04** (low, unverified-service-absent) `['GET /api/v1/inventory/low-stock']`
  - Q: GET /v1/inventory/low-stock must require an inventory role, tenant-scope, compute lowness from onHand vs reorderLevel server-side and order by nearest reorder point.
  - Verify: In the inventory-service repo open the low-stock route handler; curl /api/v1/inventory/low-stock with a token holding an inventory role (expect 200 {data,pagination}), a token with no inventory role (expect 403), and a token from another tenant (expect only own rows / 404).
  - Test: Given tenant A rows and tenant B rows, when a role without inventory access GETs /api/v1/inventory/low-stock then 403; when store_keeper of A GETs then only A rows, limit honoured, hasMore true when more exist.
  - If wrong: Cross-tenant/unauthorised stock visibility or silently truncated lists cause wrong stock decisions.
- [ ] **GAP-INVENTORY-RECEIPTS-04** (low, unverified-service-absent) `['GET /api/v1/inventory/ledger?limit=200']`
  - Q: GET /v1/inventory/ledger must require an inventory role, tenant-scope, and return enough receipt movements (type filter or larger limit) so the Receipts view is not truncated by 200 mixed rows.
  - Verify: In the inventory-service repo open the ledger route handler; curl /api/v1/inventory/ledger?limit=200 with a token holding an inventory role (expect 200 {data,pagination}), a token with no inventory role (expect 403), and a token from another tenant (expect only own rows / 404).
  - Test: Given tenant A rows and tenant B rows, when a role without inventory access GETs /api/v1/inventory/ledger?limit=200 then 403; when store_keeper of A GETs then only A rows, limit honoured, hasMore true when more exist.
  - If wrong: Cross-tenant/unauthorised stock visibility or silently truncated lists cause wrong stock decisions.
- [ ] **GAP-INVENTORY-RESERVATIONS-04** (low, unverified-service-absent) `['GET /api/v1/inventory/reservations?limit=200']`
  - Q: GET /v1/inventory/reservations must require an inventory role, tenant-scope, honour limit and expose expiry/status consistently.
  - Verify: In the inventory-service repo open the reservations route handler; curl /api/v1/inventory/reservations?limit=200 with a token holding an inventory role (expect 200 {data,pagination}), a token with no inventory role (expect 403), and a token from another tenant (expect only own rows / 404).
  - Test: Given tenant A rows and tenant B rows, when a role without inventory access GETs /api/v1/inventory/reservations?limit=200 then 403; when store_keeper of A GETs then only A rows, limit honoured, hasMore true when more exist.
  - If wrong: Cross-tenant/unauthorised stock visibility or silently truncated lists cause wrong stock decisions.
- [ ] **GAP-INVENTORY-SUBSTITUTES-04** (low, unverified-service-absent) `['GET /api/v1/inventory/items/{id}/substitutes (one call per item)', 'GET /api/v1/inventory/items']`
  - Q: GET /v1/inventory/items/:id/substitutes must require an inventory role, 404 cross-tenant ids, and a bulk substitutes list should exist so the page need not fan out one call per item.
  - Verify: In the inventory-service repo open the substitutes route handler; curl /api/v1/inventory/items/{id}/substitutes (one call per item) with a token holding an inventory role (expect 200 {data,pagination}), a token with no inventory role (expect 403), and a token from another tenant (expect only own rows / 404).
  - Test: Given tenant A rows and tenant B rows, when a role without inventory access GETs /api/v1/inventory/items/{id}/substitutes (one call per item) then 403; when store_keeper of A GETs then only A rows, limit honoured, hasMore true when more exist.
  - If wrong: Cross-tenant/unauthorised stock visibility or silently truncated lists cause wrong stock decisions.
- [ ] **GAP-PROCUREMENT-GRN-DETAIL-SRN-05** (low, unverified-service-absent) `['PATCH /api/v1/inventory/srn/:id/sign']`
  - Q: Signer must differ from GRN creator (SoD) and must hold store_officer; signing releases the payment gate exactly once.
  - Verify: Open sign handler; sign as GRN creator expecting 403 SOD_VIOLATION.
  - Test: Given GRN created by U1, when U1 signs SRN, then 403.
  - If wrong: Single person receives and certifies goods (fraud).
- [ ] **GAP-PROCUREMENT-GRN-DETAIL-SRN-NEW-06** (low, unverified-service-absent) `['POST /api/v1/inventory/srn', 'PATCH /api/v1/inventory/srn/:id/sign']`
  - Q: Only one SRN may exist per GRN (idempotent or 409) and creation/signing must be audited; the create+sign two-call flow must be atomic-safe.
  - Verify: Open inventory-service srn create; POST twice for same grnId.
  - Test: Given GRN G1 with SRN, when POST second SRN for G1, then 409.
  - If wrong: Duplicate SRNs, double stock/payment release.

## knowledge-service (12)

- [ ] **GAP-KNOWLEDGE-ASSISTANT-06** (medium, unverified-service-absent) `['POST /api/proxy/v1/knowledge/assistant/ask', 'POST /v1/knowledge/assistant/escalate', 'GET /v1/knowledge/assistant/metrics']`
  - Q: The assistant ask/escalate handlers must apply a retention limit and PII masking (Aadhaar, PAN, phone, email) to stored question text, and log an audit event per interaction.
  - Verify: Open the assistant ask handler and interaction schema in knowledge-service; POST a question containing an Aadhaar-like number and query the interactions table/log: expect masked text and a purge/retention job or TTL.
  - Test: Given question 'my Aadhaar 1234 5678 9012', when POST ask then stored interaction text has the number masked and the interaction has expiresAt within the retention window; audit event emitted.
  - If wrong: DPDP non-compliance: personal data retained indefinitely in free-text logs.
- [ ] **GAP-KNOWLEDGE-DASHBOARD-05** (medium, unverified-service-absent) `['GET /api/v1/knowledge/documents']`
  - Q: GET /v1/knowledge/documents must require an authenticated role, tenant-scope, return category/status/createdAt per row and paginate so dashboard counts are complete.
  - Verify: In knowledge-service open the route file for /api/v1/knowledge/documents; curl it with a tenant user (expect 200 {data}), with no auth (401) and with another tenant's token (expect none of this tenant's rows).
  - Test: Given tenant A and B data, when a tenant A employee GETs /api/v1/knowledge/documents then 200 with only A rows and 401 without token.
  - If wrong: Unauthorised or wrong knowledge content shown to staff.
- [ ] **GAP-KNOWLEDGE-DOCUMENTS-NEW-05** (medium, unverified-service-absent) `['POST /api/proxy/v1/knowledge/documents']`
  - Q: POST /v1/knowledge/documents must zod-validate title (max length, trim), reject or version duplicate titles per tenant, restrict to a publisher role and emit a document.created audit event.
  - Verify: Open the create handler and validator in knowledge-service; POST title of 10,000 chars (expect 400), same title twice (expect 409 or version), as a plain employee (expect 403 if restricted), and check the emitted audit event.
  - Test: Given an existing document 'Leave Policy', when POST the same title then 409 DUPLICATE_TITLE (or new version); title >256 chars gives 400; success emits one audit event with actor and documentId.
  - If wrong: Untracked or duplicated official documents; no audit trail.
- [ ] **GAP-KNOWLEDGE-FAQS-02** (medium, unverified-service-absent) `['GET /api/v1/knowledge/faqs', 'GET /api/v1/knowledge/guided-flows']`
  - Q: GET faqs and guided-flows must return only status=published items to non-editor roles (drafts/retired only for knowledge editors).
  - Verify: Open the faqs and guided-flows list handlers; seed one draft and one retired FAQ; curl as employee and expect only published; as knowledge editor expect all.
  - Test: Given FAQ statuses draft/published/retired, when an employee GETs /v1/knowledge/faqs then only the published one is returned.
  - If wrong: Unapproved or retired guidance shown to every staff member.
- [ ] **GAP-KNOWLEDGE-FAQS-04** (medium, unverified-service-absent) `['GET /api/v1/knowledge/faqs', 'GET /api/v1/knowledge/guided-flows']`
  - Q: GET faqs and guided-flows must require authentication, tenant-scope and return the fields the web maps (id, question, answer, status, category).
  - Verify: In knowledge-service open the route file for /api/v1/knowledge/faqs; curl it with a tenant user (expect 200 {data}), with no auth (401) and with another tenant's token (expect none of this tenant's rows).
  - Test: Given tenant A and B data, when a tenant A employee GETs /api/v1/knowledge/faqs then 200 with only A rows and 401 without token.
  - If wrong: Unauthorised or wrong knowledge content shown to staff.
- [ ] **GAP-KNOWLEDGE-HOME-04** (medium, unverified-service-absent) `['GET /api/v1/knowledge/* (hub links only)']`
  - Q: The knowledge hub's downstream list endpoints must each authenticate, tenant-scope and be reachable by the roles the hub shows links to.
  - Verify: In knowledge-service open the route file for /api/v1/knowledge/* (hub links only); curl it with a tenant user (expect 200 {data}), with no auth (401) and with another tenant's token (expect none of this tenant's rows).
  - Test: Given tenant A and B data, when a tenant A employee GETs /api/v1/knowledge/* (hub links only) then 200 with only A rows and 401 without token.
  - If wrong: Unauthorised or wrong knowledge content shown to staff.
- [ ] **GAP-KNOWLEDGE-LIST-05** (medium, unverified-service-absent) `['GET /api/v1/knowledge/documents']`
  - Q: GET /v1/knowledge/documents must authenticate, tenant-scope, paginate and return status/category/accessLevel per row.
  - Verify: In knowledge-service open the route file for /api/v1/knowledge/documents; curl it with a tenant user (expect 200 {data}), with no auth (401) and with another tenant's token (expect none of this tenant's rows).
  - Test: Given tenant A and B data, when a tenant A employee GETs /api/v1/knowledge/documents then 200 with only A rows and 401 without token.
  - If wrong: Unauthorised or wrong knowledge content shown to staff.
- [ ] **GAP-KNOWLEDGE-POLICIES-04** (medium, unverified-service-absent) `['GET /api/v1/knowledge/policies', 'GET /api/v1/knowledge/policies/review-due']`
  - Q: GET policies must return draft/under_review items only to editors and published to others; review-due must be tenant-scoped and computed server-side.
  - Verify: In knowledge-service open the route file for /api/v1/knowledge/policies; curl it with a tenant user (expect 200 {data}), with no auth (401) and with another tenant's token (expect none of this tenant's rows).
  - Test: Given tenant A and B data, when a tenant A employee GETs /api/v1/knowledge/policies then 200 with only A rows and 401 without token.
  - If wrong: Unauthorised or wrong knowledge content shown to staff.
- [ ] **GAP-KNOWLEDGE-POLICIES-DETAIL-06** (medium, unverified-service-absent) `['GET /api/v1/knowledge/policies/{id}', 'GET /api/v1/knowledge/policies/{id}/acknowledgements', 'POST /v1/knowledge/policies/{id}/submit|approve|publish|acknowledge']`
  - Q: Policy transition endpoints must enforce role per transition (submit: author, approve: approver != author, publish: publisher), reject invalid state transitions with 409, emit audit events, and acknowledge must bind to the caller's own employee id.
  - Verify: In knowledge-service open the policy routes; POST approve as the author (expect 403), publish on a draft (expect 409), acknowledge as an employee twice (expect idempotent) and check the acknowledgements list contains only the caller's id.
  - Test: Given draft policy P by user U, when U POSTs approve then 403; when approver POSTs approve on draft then 409; acknowledge by E twice yields one ack.
  - If wrong: Policies published without approval or acknowledgements forged for others.
- [ ] **GAP-KNOWLEDGE-RECORDS-05** (medium, unverified-service-absent) `['GET /api/v1/knowledge/records']`
  - Q: GET /v1/knowledge/records must authenticate, tenant-scope, restrict by record classification/retention and return expiry/retention dates the page uses for its 30-day window.
  - Verify: In knowledge-service open the route file for /api/v1/knowledge/records; curl it with a tenant user (expect 200 {data}), with no auth (401) and with another tenant's token (expect none of this tenant's rows).
  - Test: Given tenant A and B data, when a tenant A employee GETs /api/v1/knowledge/records then 200 with only A rows and 401 without token.
  - If wrong: Unauthorised or wrong knowledge content shown to staff.
- [ ] **GAP-KNOWLEDGE-REPOSITORY-06** (medium, unverified-service-absent) `['GET /api/v1/knowledge/documents']`
  - Q: GET /v1/knowledge/documents must apply accessLevel filtering for the caller and paginate, since the repository page lists everything returned.
  - Verify: In knowledge-service open the route file for /api/v1/knowledge/documents; curl it with a tenant user (expect 200 {data}), with no auth (401) and with another tenant's token (expect none of this tenant's rows).
  - Test: Given tenant A and B data, when a tenant A employee GETs /api/v1/knowledge/documents then 200 with only A rows and 401 without token.
  - If wrong: Unauthorised or wrong knowledge content shown to staff.
- [ ] **GAP-KNOWLEDGE-SEARCH-06** (medium, unverified-service-absent) `['GET /api/v1/knowledge/documents (search filters client-side in SearchClient.tsx)']`
  - Q: GET /v1/knowledge/documents must exclude documents whose accessLevel exceeds the caller's clearance, because search runs client-side over whatever the list returns.
  - Verify: Open the documents list handler in knowledge-service; seed a 'restricted' doc; curl as a low-privilege employee and assert it is absent from the response body (not merely hidden).
  - Test: Given a restricted document, when an employee without clearance GETs /v1/knowledge/documents then it is absent; a knowledge admin sees it.
  - If wrong: Restricted documents leak to unauthorised staff via search results.

## billing-service (11)

- [ ] **GAP-BILLING-PAYMENTS-02** (high, partly) `['GET /api/v1/billing/payments']`
  - Q: Does each payment row carry id plus one of name/title/subject/label/code/contractNo/fileNo, or only invoiceId/amount/method?
  - Verify: Open billing-service payments handler DTO; curl GET /payments and check fields against mapModuleRows (loaders.ts:1662-1671). Web-side: the generic mapper drops rows lacking a name-like field.
  - Test: Given a payment {id, invoiceId, amount, method}; when GET /payments and rendered; then row count in UI equals API count (contract test on mapper).
  - If wrong: Payments invisible in UI ('No records') though present; reconciliation errors.
- [ ] **GAP-BILLING-PLANS-DETAIL-01** (high, partly) `['POST /api/proxy/v1/billing/plans', 'GET /api/v1/billing/plans/{id}']`
  - Q: Does GET plan/{id} return the same fields posted on create (priceMinor, code, govtExempt) or rename them to amount/interval?
  - Verify: Open billing-service plans handler and DTOs; POST a plan then GET it and diff field names. Web-side: create form posts priceMinor/code/govtExempt (NewPlanForm.tsx:86-92) while detail reads amount/interval (page.tsx:23-26).
  - Test: Given plan created with priceMinor=49900, code='STD', govtExempt=true; when GET /plans/{id}; then response contains the same values under the names the page reads.
  - If wrong: Plan price displayed wrongly or blank; billing misconfiguration.
- [ ] **GAP-ADMIN-INVOICES-02** (high, unverified-service-absent) `GET /api/v1/billing/invoices`
  - Q: Is invoice amount returned as integer paise (bigint as string) or rupees, and is the unit documented in the response schema?
  - Verify: Open billing-service invoices schema/handler; curl as super_admin and compare a known invoice total against the stored value.
  - Test: Given an invoice of Rs 1,18,000.00, when GET invoices, then amount equals 11800000 (paise) or documented rupee field.
  - If wrong: Invoice totals shown 100x wrong to operators.
- [ ] **GAP-ADMIN-METERING-02** (high, unverified-service-absent) `GET /api/v1/billing/metering`
  - Q: Is invoice amount returned as integer paise (bigint as string) or rupees, and is the unit documented in the response schema?
  - Verify: Open billing-service metering schema/handler; curl as super_admin and compare a known usage amount to its stored value.
  - Test: Given metered usage costing Rs 2,500.50, when GET metering, then amount is 250050 paise (or documented rupee value).
  - If wrong: Invoice totals shown 100x wrong to operators.
- [ ] **GAP-BILLING-INVOICES-DETAIL-01** (high, unverified-service-absent) `['POST v1/billing/invoices/{id}/generate-irn', 'POST v1/billing/invoices/{id}/cancel-irn', 'GET /api/v1/billing/invoices/{id}/einvoice']`
  - Q: Which roles may generate and cancel IRN, is cancel limited to the GST window (24h) with reason required, and is it idempotent and audited?
  - Verify: Open billing-service e-invoice routes; check role guard, 24h window, reason validation, idempotency key, audit insert. POST cancel-irn as viewer, then twice as finance_admin.
  - Test: Given viewer role; when cancel-irn; then 403. Given finance_admin and IRN older than 24h; then 422. Repeated generate-irn returns same IRN/202 with same id.
  - If wrong: Irreversible GSTN actions by unauthorised users; duplicate IRN attempts; tax penalties.
- [ ] **GAP-BILLING-HOME-01** (medium, unverified-service-absent) `['GET /api/v1/billing/invoices', 'POST v1/billing/invoices/{id}/generate-irn', 'POST .../cancel-irn', 'GSTN console endpoints']`
  - Q: Do billing routes enforce billing/finance roles server-side, so a plain tenant user gets 403 on invoice, IRN and GSTN endpoints?
  - Verify: Open billing-service route registration; check preHandler role on invoices, IRN and GSTN return-filing. curl each as role 'viewer' expecting 403.
  - Test: Given role viewer; when GET /billing/invoices, POST generate-irn, POST GSTN file; then 403 for each.
  - If wrong: Any tenant user can file GST returns or cancel IRNs.
- [ ] **GAP-PRICING-HOME-04** (medium, unverified-service-absent) `['GET /api/v1/billing/plans']`
  - Q: Do billing plans return module count, user limit, storage and SLA matching the marketing figures (33 modules, 25/500 users, 10/100 GB, 99.5/99.9%)?
  - Verify: Open billing-service plans seed/route; compare limits with (marketing)/pricing/page.tsx:17-43.
  - Test: Given plans seeded, when GET billing/plans, then plan.limits equal the values rendered on /pricing (contract test).
  - If wrong: Published price/limits differ from contract.
- [ ] **GAP-TENANT-ADMIN-SUBSCRIPTION-03** (medium, unverified-service-absent) `['GET /api/v1/billing/subscriptions (loaders.ts:4308)']`
  - Q: Is subscription amount returned in paise (minor units) or rupees?
  - Verify: Open billing-service subscription DTO/Drizzle schema (bigint minor units per CLAUDE.md rule 11); curl and compare with plan price.
  - Test: Given plan INR 4,999/month, when GET subscription, then amount=499900 and currency='INR'.
  - If wrong: Displayed amount 100x too high on customer billing page.
- [ ] **GAP-BILLING-INVOICES-06** (low, unverified-service-absent) `['GET /api/v1/billing/invoices']`
  - Q: Does the invoices list cap results and support page/status query params?
  - Verify: Open billing-service invoices list handler; check limit default/max and query schema (status, page). GET with 2000 invoices.
  - Test: Given 2000 invoices; when GET /invoices; then response is capped at default page size with meta.total and honours ?status=.
  - If wrong: Truncated list appears complete; or heavy payload slows the page.
- [ ] **GAP-TENANT-ADMIN-PLANS-06** (low, unverified-service-absent) `['GET /api/v1/billing/plans (loaders.ts getPlansData ~L4600)']`
  - Q: Are plan prices and invoice amounts returned as integer paise (bigint minor units) with an ISO currency code?
  - Verify: Open billing-service plans DTO and Drizzle schema; curl and check priceMinor is integer with currency field.
  - Test: Given a plan of INR 1,499.50, when listed, then price=149950 (paise) and currency='INR'.
  - If wrong: Amounts shown 100x wrong or rounding errors on billing pages.
- [ ] **GAP-TENANT-ADMIN-SUBSCRIPTION-06** (low, unverified-service-absent) `['GET /api/v1/billing/subscriptions', 'GET /api/v1/billing/invoices/latest?format=pdf']`
  - Q: What are the subscription status values (trialing, active, past_due, cancelled) and what do limit fields mean (hard cap vs soft, unit)?
  - Verify: Open billing-service subscription enum and limits schema; curl subscriptions in each state.
  - Test: Given past_due subscription, when read, then status='past_due' and web shows warning not active.
  - If wrong: Wrong entitlement/billing status shown to customer.

## citizen-service (11)

- [ ] **GAP-CITIZEN-APPEALS-01** (high, unverified-service-absent) `['POST /v1/citizen/appeals', 'GET /api/v1/citizen/appeals']`
  - Q: Does the server derive the appeal filing window from the decision type and ignore or reject client-sent windowDays?
  - Verify: Open appeals handler; POST with windowDays=3650 for a decision whose limit is 30 and check outcome.
  - Test: Given a decision dated 90 days ago with a 30-day limit, when POST appeal with windowDays=3650, then 422 APPEAL_WINDOW_EXPIRED.
  - If wrong: Time-barred appeals accepted; statutory breach; high.
- [ ] **GAP-CITIZEN-CERTIFICATES-01** (high, unverified-service-absent) `['GET /api/proxy/v1/citizen/certificates/verify/:id']`
  - Q: Is there a public unauthenticated verify endpoint returning only minimal validity data (no PII) that a QR can resolve?
  - Verify: Check gateway public allowlist and certificates verify route auth; curl without a token.
  - Test: Given no auth header, when GET verify with valid certificate no, then 200 {valid, issuedTo(masked), issuedOn}; invalid gives valid:false, rate limited.
  - If wrong: Third parties cannot verify certificates; trust failure, or PII leak if opened badly; high.
- [ ] **GAP-CITIZEN-DOCUMENTS-01** (high, unverified-service-absent) `['POST /v1/citizen/documents/upload', 'POST /v1/citizen/documents/digilocker-fetch', 'GET /v1/citizen/documents/checklist']`
  - Q: Does /documents/upload accept a JSON declaration without a file, or does it require a presigned or multipart file with size/type/virus checks?
  - Verify: Open upload handler and schema; POST {applicationId,serviceId,docType} and see if a document is marked uploaded.
  - Test: Given JSON without file reference, when POST upload, then 400 FILE_REQUIRED; with file, content-type and size are validated.
  - If wrong: Applications marked complete with no evidence; high.
- [ ] **GAP-CITIZEN-PAYMENTS-03** (high, unverified-service-absent) `['POST /v1/citizen/payments/offline']`
  - Q: Is recording an offline payment restricted to a cashier role and audited with operator id, receipt no and amount?
  - Verify: Open payments/offline route guard; curl with a citizen token expecting 403; inspect audit row after a cashier call.
  - Test: Given a citizen role, when POST offline payment, then 403; given cashier, then 201 with audit actor and unique receipt.
  - If wrong: Fraudulent payment marking, fee leakage; high.
- [ ] **GAP-CITIZEN-REQUESTS-DETAIL-01** (high, unverified-service-absent) `['POST /v1/citizen/grievances/:id/{resolve,escalate,reopen,actions}']`
  - Q: Are resolve, escalate and add-action limited to officer roles and reopen to the owning citizen, with 403 otherwise?
  - Verify: Open grievances route guards; curl resolve with a citizen token and with another citizen's reopen.
  - Test: Given non-officer, when POST resolve, then 403; given other citizen, when reopen, then 403/404.
  - If wrong: Any user can close or escalate grievances; high.
- [ ] **GAP-CITIZEN-RTI-DETAIL-01** (high, unverified-service-absent) `['GET /v1/citizen/rti/:id', 'POST /v1/citizen/rti/:id/respond', 'POST /v1/citizen/rti/:id/appeal']`
  - Q: Is respond restricted to PIO role, appeal to the applicant, and is appeal refused before a response or deadline breach?
  - Verify: Open rti routes; curl respond as applicant (expect 403), appeal on a fresh RTI (expect 409).
  - Test: Given applicant token, when POST respond, then 403; given RTI within deadline without response, when POST appeal, then 409 APPEAL_NOT_ALLOWED.
  - If wrong: Applicant can answer own RTI; premature appeals; statutory risk; high.
- [ ] **GAP-CITIZEN-SERVICES-SERVICEKEY-TRACK-TRACKINGNO-02** (high, unverified-service-absent) `['GET /v1/citizen/intake/track/:trackingNo']`
  - Q: Is tracking lookup scoped to the caller (or requires a secret), and are tracking numbers non-guessable and rate limited?
  - Verify: Open intake/track handler; request another citizen's tracking no with a different token and unauthenticated; check number format entropy.
  - Test: Given citizen B token, when GET track for citizen A's number, then 403/404; sequential guesses are rate limited.
  - If wrong: Enumeration of citizen applications (DPDP breach); high.
- [ ] **GAP-CITIZEN-FEEDBACK-03** (medium, unverified-service-absent) `['(none referenced) expected POST /v1/citizen/feedback']`
  - Q: Does a citizen feedback endpoint exist, with validation, rate limit and citizen ownership?
  - Verify: Search citizen-service routes for feedback; if none, raise a backend ticket.
  - Test: Given a signed-in citizen, when POST feedback with rating 1-5 and text, then 201; anonymous or oversize input rejected.
  - If wrong: Feedback page has nothing to submit to; medium.
- [ ] **GAP-CITIZEN-SERVICES-SERVICEKEY-02** (medium, unverified-service-absent) `['GET /api/v1/citizen/catalogue/published/lookup', 'POST /v1/citizen/intake (channel)']`
  - Q: Does the server verify an authenticated operator/role before accepting channel=counter, rejecting CHANNEL_NOT_ALLOWED otherwise?
  - Verify: Open intake handler channel check; POST with channel=counter using a citizen token.
  - Test: Given citizen token, when POST intake channel=counter, then 403 CHANNEL_NOT_ALLOWED; operator token succeeds with operator id audited.
  - If wrong: Citizens spoof counter channel bypassing online rules; medium.
- [ ] **GAP-CITIZEN-PORTAL-05** (low, unverified-service-absent) `['GET /v1/citizen/portal/metrics']`
  - Q: How are active and resolved defined (statuses included, time window, SLA) in portal/metrics?
  - Verify: Open citizen-service requests/routes.ts portal/metrics query and compare status sets to grievance enum.
  - Test: Given grievances in each status, when GET metrics, then active counts open+in-progress+escalated and resolved counts resolved only (not closed-reopened).
  - If wrong: Misleading public KPIs; low.
- [ ] **GAP-CITIZEN-REQUESTS-07** (low, unverified-service-absent) `['GET/POST /api/proxy/v1/citizen/grievances', 'GET /api/v1/crm/grievances (loader)']`
  - Q: What RBAC, status enum and audit apply to grievance list and create, and is list scoped to caller or department?
  - Verify: Open grievances routes; call list as citizen and as officer and compare row sets; check audit on create.
  - Test: Given citizen A, when GET grievances, then only A's rows; creating emits audit row.
  - If wrong: Cross-citizen data exposure; high.

## finance-service (11)

- [ ] **GAP-FINANCE-REVENUE-CHALLANS-DETAIL-01** (high, unverified-service-absent) `['GET /v1/finance/challans/:id']`
  - Q: Does GET /v1/finance/challans/:id exist and return the challan with tenant scoping and finance read roles?
  - Verify: Grep finance-service revenue routes for '/v1/finance/challans/:id'; curl with a valid challan id expecting 200, unknown id 404.
  - Test: Given a challan id from the list when GET challans/:id then 200 with same id; other tenant's id returns 404.
  - If wrong: Register rows lead to a dead detail page.
- [ ] **GAP-FINANCE-BUDGET-SANCTIONS-04** (medium, unverified-service-absent) `['POST /v1/finance/sanctions']`
  - Q: Which roles may POST sanctions and does the API return 403 with a clear code for others?
  - Verify: Open sanctions create handler in finance-service; read requireRole list. curl as audit_officer, expect 403.
  - Test: Given audit_officer when POST sanction then 403 FORBIDDEN; given finance_officer then 201.
  - If wrong: Users fill a dialog then hit a late 403; if permissive, unauthorised sanctions.
- [ ] **GAP-FINANCE-BUDGET-SANCTIONS-DETAIL-04** (medium, unverified-service-absent) `['POST /v1/finance/sanctions/:id/approve', 'GET /v1/finance/sanctions/:id']`
  - Q: Does approve reject when the approver equals the proposer (createdBy) and restrict to approver roles?
  - Verify: Open approve handler in finance-service; check createdBy != actor and requireRole(APPROVER_ROLES). curl as proposer expect 403/409.
  - Test: Given sanction created by A when A approves then 403 SELF_APPROVAL; when approver B approves then 200 and audit event.
  - If wrong: Self-approval of sanctions defeats maker-checker.
- [ ] **GAP-FINANCE-CHART-OF-ACCOUNTS-03** (medium, unverified-service-absent) `['GET /v1/finance/accounts']`
  - Q: Is balanceDisplay a locale-formatted string with sign, and is a numeric balance in paise also returned?
  - Verify: Open the accounts list handler/schema in finance-service; inspect balanceDisplay and any balance minor field.
  - Test: Given an account with balance -1234567 paise when listed then balanceMinor=-1234567 is present and balanceDisplay is '-12,345.67' lakh-grouped.
  - If wrong: Wrong/unsigned balances shown to accountants.
- [ ] **GAP-FINANCE-EXPENDITURE-BILLS-DETAIL-03** (medium, unverified-service-absent) `['POST /v1/finance/bills/:id/pass', 'POST /v1/finance/bills/:id/pay']`
  - Q: Do pass and pay require distinct users (maker != checker) and respective roles?
  - Verify: Open bill pass/pay handlers in finance-service; check actor != preparer/passer. curl pay as the passer expecting 403/409.
  - Test: Given bill passed by A when A pays then 409 MAKER_CHECKER; when B pays then 200.
  - If wrong: Single officer can pass and pay a bill; fraud risk.
- [ ] **GAP-FINANCE-PAYMENTS-04** (medium, unverified-service-absent) `['POST /v1/finance/payments', 'POST /v1/finance/payments/pfms-sync']`
  - Q: Which roles may create payments and trigger PFMS sync, and does the API 403 audit/budget officers before requiring a reason?
  - Verify: Open payments routes in finance-service; read requireRole lists. curl POST as audit_officer expecting 403.
  - Test: Given audit_officer when POST payment then 403; given accounts_officer then 201.
  - If wrong: Unauthorised payment creation, or wasted user effort on a late 403.
- [ ] **GAP-FINANCE-ACCOUNTING-GENERAL-LEDGER-05** (low, unverified-service-absent) `['GET /v1/finance/journals/:id/pdf']`
  - Q: Does the journal PDF endpoint enforce the same reader roles as GET /v1/finance/journals and tenant scoping?
  - Verify: Open the pdf route in finance-service; check requireRole/READER_ROLES and tenant filter. curl as a non-finance role, expect 403.
  - Test: Given role without finance read when GET journals/:id/pdf then 403; journal of another tenant returns 404.
  - If wrong: Journal PDFs downloadable by unauthorised users or cross-tenant.
- [ ] **GAP-FINANCE-ACCOUNTING-VOUCHERS-NEW-06** (low, unverified-service-absent) `['POST /v1/finance/journals']`
  - Q: Does POST journals reject a postingDate in a closed period with a clear error code?
  - Verify: Open journals create handler in finance-service; check a period-status lookup. Close a period then POST with a date in it, expect 409/422.
  - Test: Given period 2026-03 closed when POST journal dated 2026-03-15 then 422 PERIOD_CLOSED and nothing is posted.
  - If wrong: Postings into closed periods corrupt filed accounts.
- [ ] **GAP-FINANCE-AUDIT-PARAS-DETAIL-05** (low, unverified-service-absent) `['GET /v1/finance/audit-paras/:id']`
  - Q: Is GET audit-paras/:id restricted to audit/finance roles per endpoint, and are dates ISO strings?
  - Verify: Open audit-paras routes in finance-service; check READER_ROLES and response date format.
  - Test: Given role budget_officer when GET audit para then 403 if not permitted; dates are ISO-8601.
  - If wrong: Officer names in audit observations exposed to unrelated finance roles.
- [ ] **GAP-FINANCE-CHART-OF-ACCOUNTS-05** (low, unverified-service-absent) `['POST /v1/finance/accounts', 'GET /v1/finance/accounts']`
  - Q: Which roles may create account heads, and does GET return parentId for building a tree?
  - Verify: Open accounts routes in finance-service; read requireRole for POST and the list schema for parentId.
  - Test: Given non-admin when POST account then 403; list items include parentId.
  - If wrong: Unauthorised head creation; hub copy misleading.
- [ ] **GAP-FINANCE-JOURNAL-ENTRY-06** (low, unverified-service-absent) `['POST /v1/finance/journals']`
  - Q: Does POST journals enforce a unique voucher number per tenant (409 on duplicate) or allocate it server-side when omitted?
  - Verify: Open the journals create handler/schema in finance-service; check unique index on (tenantId, voucherNo). POST the same voucherNo twice, expect 409 on the second.
  - Test: Given voucherNo JV-2026-001 exists when POST again then 409 DUPLICATE_VOUCHER and no second journal is posted.
  - If wrong: Duplicate voucher numbers break audit trail and reconciliation.

## identity-service (10)

- [ ] **GAP-AUTH-DEV-06** (low, partly) `['POST /api/auth/dev-login (web-local)', 'seed: scripts/demo/seed-demo.mjs']`
  - Q: Do the seeded demo personas' roles match the descriptions on the dev page (e.g. auditor = Audit + Legal)?
  - Verify: Compare USERS map in apps/web/src/app/api/auth/dev-login/route.ts with identity-service/Keycloak seed (scripts/demo/seed-demo.mjs). Note web map gives auditor roles audit_officer, audit_admin, reader, viewer only - no legal role.
  - Test: Given persona 'auditor'; when logged in; then role set equals the roles listed in the dev page description (test compares page copy to USERS roles).
  - If wrong: Misleading demo/training; wrong expectations of access in UAT.
- [ ] **GAP-AUTH-FORGOT-06** (low, partly) `['POST /api/auth/forgot (no route in web app)']`
  - Q: Does identity-service expose a password-reset route that issues an expiring single-use token and sends email?
  - Verify: Search identity-service routes for reset/forgot; ForgotForm.tsx comment states none exists. Web has no apps/web/src/app/api/auth/forgot route, so request 404s.
  - Test: Given a registered email; when POST /identity/password-reset/request; then 202 with same body for unknown emails, token expires in <=30 min, single use, email enqueued.
  - If wrong: Users cannot recover accounts while UI claims an email was sent (false assurance).
- [ ] **GAP-IDENTITY-API-KEYS-03** (high, unverified-service-absent) `['GET /api/v1/admin/api-keys']`
  - Q: GET /v1/admin/api-keys must never return secret key material (only id, name, prefix, scopes, createdAt, lastUsedAt, status) and must include a stable id.
  - Verify: In identity-service open the admin api-keys list handler and its response schema; curl GET /v1/admin/api-keys as tenant_admin and assert no field named key/secret/hash and that every row has a UUID id.
  - Test: Given an API key was just created, when tenant_admin lists keys, then each row has id and keyPrefix and no property matching /secret|key$|hash/ ; response schema test fails if one is added.
  - If wrong: Secret disclosure into HTML, the offline cache (useSeededResource) and logs; credential compromise.
- [ ] **GAP-AUTH-LOGIN-06** (low, unverified-service-absent) `['GET /api/auth/callback (web) -> Keycloak token endpoint', 'POST /api/identity/sessions']`
  - Q: Which error codes can /api/auth/callback redirect with, and does login/page.tsx map all of them?
  - Verify: Web callback emits invalid_callback and token_exchange_failed (callback/route.ts:32,71); check Keycloak realm/identity-service for others (access_denied, session create failures) and compare with the map in auth/login/page.tsx.
  - Test: Given each error code emitted by callback; when /auth/login?error=<code>; then a specific message renders, unknown code shows generic message.
  - If wrong: Users see blank/unhelpful login failures.
- [ ] **GAP-TENANT-ADMIN-IDP-05** (low, unverified-service-absent) `['GET /api/v1/admin/idp/providers (loaders.ts ~L4701)']`
  - Q: What is the complete enum of IdP provider status values returned (beyond 'active')?
  - Verify: Open identity/admin-service idp provider schema/enum; curl the endpoint with providers in each state.
  - Test: Given providers in states created, testing, active, failed, disabled, when listed, then status is one of the documented enum and web maps each to a pill.
  - If wrong: Unknown status renders wrongly (e.g. failed IdP shown as healthy).
- [ ] **GAP-TENANT-ADMIN-MFA-05** (low, unverified-service-absent) `['GET /api/v1/admin/mfa/users (loaders.ts ~L4683)']`
  - Q: What is the full enum of mfaStatus (e.g. enrolled, pending, disabled, exempt) returned?
  - Verify: Open identity-service MFA status enum / DTO; query users in each state.
  - Test: Given users with each MFA state, when GET /v1/admin/mfa/users, then mfaStatus is within the documented enum.
  - If wrong: Users without MFA shown as compliant.
- [ ] **GAP-TENANT-ADMIN-SESSIONS-06** (low, unverified-service-absent) `['GET /api/identity/sessions', 'DELETE /api/proxy/identity/sessions/:id (SessionsTable.tsx:57)']`
  - Q: Does DELETE /sessions/:id only revoke sessions in the caller's tenant (404 otherwise) and emit an audit event?
  - Verify: Open identity-service sessions route; DELETE a tenant B session id as tenant A admin.
  - Test: Given session of tenant B, when tenant A admin DELETEs, then 404 and session remains; own-tenant delete gives 204 with session.revoked audit.
  - If wrong: Cross-tenant session kill (DoS) or unaudited revocation.
- [ ] **GAP-TENANT-ADMIN-SSO-06** (low, unverified-service-absent) `['GET /api/v1/admin/sso/providers (loaders.ts:4532)']`
  - Q: Does the response omit provider secrets (clientSecret, signing keys) and what status values exist?
  - Verify: Open identity-service SSO provider serializer; curl as tenant_admin and grep response for secret.
  - Test: Given provider with clientSecret set, when listed, then response has hasSecret:true and no secret value.
  - If wrong: SSO client secret exposure in browser.
- [ ] **GAP-TENANT-ADMIN-USERS-07** (low, unverified-service-absent) `['POST /api/proxy/v1/admin/users (UsersTable.tsx:181)', 'GET /api/identity/users']`
  - Q: Does creating/inviting a user send an invitation email, apply a least-privilege default role, and emit an audit event?
  - Verify: Open identity-service/gateway /v1/admin/users alias handler; create user without role and check role assignment, mail outbox and audit.
  - Test: Given invite with no role, when POST, then user has default least-privilege role, invitation queued, audit user.invited emitted; duplicate email gives 409.
  - If wrong: Over-privileged new accounts or unaudited user creation.
- [ ] **GAP-TENANT-ADMIN-USERS-DETAIL-06** (low, unverified-service-absent) `['POST /api/proxy/identity/users/:id/reset-password', 'POST /api/proxy/identity/users/:id/sessions/revoke-all (UserSecurityActions.tsx:51,59)']`
  - Q: Is reset-password tenant-scoped, role-restricted, audited and rate-limited per target user and per actor?
  - Verify: Open identity-service users routes; fire 6 resets in 1 min for one user; try user of another tenant.
  - Test: Given 6 reset requests in 60s for one user, when the last is sent, then 429; every accepted request emits user.password_reset_requested audit; cross-tenant id returns 404.
  - If wrong: Account takeover/mail-bombing via admin action; missing audit trail.

## hrms-service (10)

- [ ] **GAP-HR-HOLIDAYS-01** (high, defect) `['GET /v1/hrms/holidays']`
  - Q: See evidence.
  - Verify: Verified by reading source; see evidence.
  - Test: Given manager-only token, when GET /v1/hrms/holidays then 200.
  - If wrong: Managers cannot view the holiday calendar.
- [ ] **GAP-LEARNING-COURSES-DETAIL-01** (high, defect) `['POST /v1/hrms/learning/courses/{id}/enroll']`
  - Q: See evidence.
  - Verify: Verified by reading source; see evidence.
  - Test: Given employee E, when E POSTs JSON enroll with another employee's id then 403; own id then 201.
  - If wrong: Enrolment fails and any user can enrol others.
- [ ] **GAP-RECRUITMENT-DETAIL-03** (high, partly) `['PUT/GET /v1/hrms/job-openings/:id/reservation-roster', 'POST .../reservation-roster/approve', 'POST .../reservation-shortlist']`
  - Q: Does the service already provide the sanctioned roster with role gate and SoD?
  - Verify: Read reservation-routes.ts and reservation-domain.ts.
  - Test: Given roster created by U, when U approves, then 403 SOD_VIOLATION; assert EWS accepted and PwBD rejected until added.
  - If wrong: Recruitment shortlists on incorrect reservation quotas; legal challenge.
- [ ] **GAP-FINANCE-EXPENSES-01** (medium, defect) `['redirect /finance/expenses -> /hr/expenses']`
  - Q: 
  - Verify: 
  - Test: Layout test: role finance_officer requesting /hr/expenses is not shown Access restricted.
  - If wrong: Finance roles land on a permission wall.
- [ ] **GAP-FINANCE-LOANS-01** (medium, defect) `['redirect /finance/loans -> /hr/loans']`
  - Q: 
  - Verify: 
  - Test: Layout test: finance_officer requesting /hr/loans is allowed.
  - If wrong: Finance roles land on a permission wall.
- [ ] **GAP-FINANCE-MEDICAL-01** (medium, defect) `['redirect /finance/medical -> /hr/medical', 'GET /v1/hrms/medical/claims']`
  - Q: 
  - Verify: 
  - Test: Layout test: finance_officer requesting /hr/medical renders the page.
  - If wrong: Finance roles land on a permission wall.
- [ ] **GAP-HR-DASHBOARD-07** (medium, defect) `['GET /v1/hrms/dashboard']`
  - Q: 
  - Verify: 
  - Test: Vitest on dashboard queries: 10 headcount, 2 on_leave, 4 present -> attendanceTodayPct=50 (4/8); zero attendance rows -> null.
  - If wrong: 
- [ ] **GAP-HR-EMPLOYEES-DETAIL-04** (medium, defect) `['GET /v1/hrms/lifecycle/transfers?employeeId=', 'GET /v1/hrms/lifecycle/promotions?employeeId=', 'GET /v1/hrms/deputation?employeeId=']`
  - Q: See evidence.
  - Verify: Verified by reading source; see evidence.
  - Test: Given employees A and B each with a transfer, when GET transfers?employeeId=A then only A's row.
  - If wrong: Cross-employee HR history leaks into each profile; wrong service history.
- [ ] **GAP-HR-EMPLOYEES-DETAIL-EDIT-05** (medium, partly) `['GET /v1/hrms/employees?limit=500']`
  - Q: Does GET /v1/hrms/employees accept limit=500 and exclude separated staff?
  - Verify: Open employee/repo.ts:51 and packages/schemas common listQuerySchema; curl GET /v1/hrms/employees?limit=500 as hr_admin (expect 200) and ?limit=501 (expect 400).
  - Test: Given tenant with 1 active, 1 separated employee, when hr_admin GETs /v1/hrms/employees?limit=500&status=active, then 200 and only the active row; limit=501 returns 400 VALIDATION_FAILED.
  - If wrong: A separated employee or self can be set as reporting manager, breaking approval routing.
- [ ] **GAP-FINANCE-TRAVEL-04** (low, partly) `['redirect /finance/travel -> /hr/travel']`
  - Q: 
  - Verify: Check finance-service has no /v1/finance/travel-claims route.
  - Test: Route test: GET /v1/finance/travel-claims returns 404 in finance-service.
  - If wrong: Low: stale redirect only.

## legal-service (10)

- [ ] **GAP-LEGAL-COURT-ORDERS-NEW-01** (high, unverified-service-absent) `['POST /api/v1/legal/cases/:id/orders', 'GET /api/v1/legal/court-orders']`
  - Q: When POST orders omits complianceRequired/complianceDeadline, does the service derive them (default false/null or by orderType) so Compliance Due and Contempt Risk counts are meaningful?
  - Verify: Open legal-service orders create handler and schema defaults; curl POST body {orderType:'direction',summary,orderDate,direction,deptRef} and GET the order, inspect complianceRequired/complianceDeadline.
  - Test: Given a direction-type order posted with no compliance fields, when listed, then complianceRequired=true and deadline derived from direction (or explicit null documented).
  - If wrong: Contempt exposure: orders with deadlines never appear as due, so court directions are missed.
- [ ] **GAP-LEGAL-CASES-NEW-03** (medium, unverified-service-absent) `['POST /api/v1/legal/cases']`
  - Q: Does create reject a duplicate case number with 409 and a field-level error, return the new id, and write an audit row?
  - Verify: Open legal-service cases create handler + unique index on (court, caseNo); curl POST the same body twice as legal_officer expecting 201 then 409; inspect audit table.
  - Test: Given case CN-1 exists, when POST case with CN-1, then 409 DUPLICATE_CASE_NO; on success response contains data.id and audit action legal.case.created.
  - If wrong: Duplicate case records split hearing/order history; no audit trail of who registered a case.
- [ ] **GAP-LEGAL-HOME-01** (medium, unverified-service-absent) `['all /api/v1/legal/* routes']`
  - Q: Do legal-service routes enforce a per-route role allow-list that excludes finance_admin from cases, opinions and privileged advice, independent of the web layout?
  - Verify: Open legal-service route preHandlers; curl GET /v1/legal/opinions/:id and POST /v1/legal/cases with a finance_admin JWT expecting 403.
  - Test: Given finance_admin token, when GET opinion detail or POST case, then 403 FORBIDDEN and no data returned.
  - If wrong: Privileged legal advice readable by non-legal staff; loss of privilege.
- [ ] **GAP-LEGAL-OPINIONS-04** (medium, unverified-service-absent) `['GET /api/v1/legal/opinions', 'GET /api/v1/legal/opinions/:id']`
  - Q: Do list and detail return the same field names (advisorName/counselName, requestedBy/soughtBy)?
  - Verify: Compare response DTOs in legal-service; curl both endpoints for one id and diff keys.
  - Test: Given one opinion, when GET list and detail, then counsel and requester fields resolve to same values under documented names.
  - If wrong: Blank counsel/requester on one screen.
- [ ] **GAP-LEGAL-OPINIONS-DETAIL-03** (medium, unverified-service-absent) `['POST /api/v1/legal/opinions/:id/submit-approval']`
  - Q: Does this route exist, and if so does it require the eFile reference, restrict roles and write an audit row?
  - Verify: Grep legal-service routes for submit-approval; if absent curl POST expecting non-404.
  - Test: Given opinion id, when POST submit-approval with valid role, then 200 and audit row; unknown id gives 404 and web shows the error.
  - If wrong: Approval notification silently lost while UI shows success.
- [ ] **GAP-LEGAL-OPINIONS-NEW-03** (medium, unverified-service-absent) `['POST /api/v1/legal/notices']`
  - Q: How is partyRef resolved (employee id, dept code, free text) and is an unresolvable value rejected with 422?
  - Verify: Open legal-service notices create handler/validator; curl POST with partyRef 'xyz' expecting 422.
  - Test: Given unknown partyRef, when POST notice, then 422 with field partyRef; valid directory id creates a routed notice.
  - If wrong: Opinion requests routed to nobody.
- [ ] **GAP-LEGAL-CASES-DETAIL-06** (low, unverified-service-absent) `['GET /api/v1/legal/cases/:id', 'POST /api/v1/legal/counsel-briefs', 'POST /api/v1/legal/cases/:id/orders']`
  - Q: Does GET cases/:id return party names only to roles allowed to see them, do the POSTs write an audit row (actor, case id, action), and is fee handling validated server-side?
  - Verify: Open services/legal-service/src/modules/cases + counsel routes; check role preHandler and audit insert; curl GET /v1/legal/cases/:id as finance_admin and as legal_officer and diff party fields.
  - Test: Given a finance_admin token, when GET case detail, then partyNames are masked or 403; given legal_officer POST counsel-briefs, then one audit row with actor+caseId exists.
  - If wrong: DPDP exposure of litigant PII; unaudited counsel fee commitments.
- [ ] **GAP-LEGAL-DASHBOARD-06** (low, unverified-service-absent) `['GET /api/v1/legal/dashboard (loader in legal/dashboard/page.tsx)']`
  - Q: How does the service define each dashboard counter (open, hearings this week, overdue) and is the count scoped by user role/department?
  - Verify: Open the legal-service dashboard/summary query; compare filters to labels on page.tsx; curl as two roles and compare counts against list endpoints.
  - Test: Given 3 open + 2 disposed cases, when GET dashboard, then openCases=3 and matches GET cases?status=open total.
  - If wrong: Misleading management counters.
- [ ] **GAP-LEGAL-HEARINGS-05** (low, unverified-service-absent) `['POST /api/v1/legal/cases/:id/reminder', 'POST /api/v1/legal/hearings']`
  - Q: Does the reminder POST resolve recipients server-side (assigned counsel/officer), enqueue via notification queue, and write an audit row?
  - Verify: Open legal-service reminder handler; curl POST reminder as legal_officer; check queue message recipients and audit row.
  - Test: Given case with assigned officer, when POST reminder, then one notification event to that officer and audit legal.hearing.reminder; a role without access gets 403.
  - If wrong: Reminders silently go nowhere or to wrong people; missed hearings.
- [ ] **GAP-LEGAL-LIST-04** (low, unverified-service-absent) `['GET /api/v1/legal/cases']`
  - Q: Is advocateName a free-text column or joined from a counsel master (counsel id -> name) in the list response?
  - Verify: Open legal-service cases list query/schema; curl GET cases and inspect advocateName/counselId fields.
  - Test: Given case linked to counsel C1, when GET list, then advocateName equals C1.name and counselId is present.
  - If wrong: Inconsistent counsel names break counsel-wise reporting.

## revenue-service (10)

- [ ] **GAP-REVENUE-ADJUSTMENTS-01** (high, unverified-service-absent) `['POST /api/v1/revenue/adjustments']`
  - Q: Does a balance-transfer adjustment require a different approver (maker-checker) or a specific role, and is it audited with both demand ids?
  - Verify: Open revenue-service adjustments route/service; look for status pending/approved and checker!=maker rule. POST type=transfer as a single officer and check whether balances change immediately.
  - Test: Given officer A creates a transfer between demands; when no second approval; then balances unchanged and status=pending; when B approves then applied and audit event has from/to demand.
  - If wrong: Fraud: arrears silently moved off a defaulter's demand.
- [ ] **GAP-REVENUE-BBPS-01** (high, unverified-service-absent) `['POST /api/v1/revenue/bbps/fetch-bill', 'POST /api/v1/revenue/bbps/pay-bill']`
  - Q: Does pay-bill verify the BBPS txn id against the BBPS/BBPCU gateway (bill match, amount match, uniqueness) before crediting?
  - Verify: Open pay-bill handler in revenue-service; check for BBPS adapter call/reconciliation, unique constraint on txnId, and amount equals fetched bill. POST an invented txnId.
  - Test: Given unknown txnId; when POST pay-bill; then 422 and no receipt; given duplicate txnId then 409; given amount mismatch then 422.
  - If wrong: Fake payments credited to assessees: direct revenue loss.
- [ ] **GAP-REVENUE-CONFIG-01** (high, unverified-service-absent) `['POST /api/v1/revenue/rate-heads', 'POST /api/v1/revenue/rate-slabs', 'POST /api/v1/revenue/penalty-rules', 'POST /api/v1/revenue/rebate-rules']`
  - Q: Are rate rows versioned with effective dates, restricted to a config-admin role, audited, and is maker-checker enforced?
  - Verify: Open the rate config routes and schema: effectiveFrom/To, version column, overlap validation, role guard, audit. POST overlapping slab as non-admin.
  - Test: Given an existing slab for a period; when POST an overlapping slab; then 409; given non-admin then 403; approved rows carry version and audit event.
  - If wrong: Wrong tax/penalty computed for every demand with no way to correct rows.
- [ ] **GAP-REVENUE-RECEIPTS-01** (high, unverified-service-absent) `['POST /api/v1/revenue/receipts']`
  - Q: Is POST receipts idempotent (Idempotency-Key header or unique tenant+UTR constraint) so a retry cannot record the same UTR twice?
  - Verify: Open receipts handler and DB migration for unique (tenantId, utr) or idempotency table; send the same POST twice with identical UTR.
  - Test: Given receipt with UTR X exists; when POST the same body again; then 200 with same receipt id (or 409), and only one ledger entry exists.
  - If wrong: Double-credited payments; ledger and bank reconciliation break.
- [ ] **GAP-REVENUE-RECOVERY-01** (high, unverified-service-absent) `['POST /api/v1/revenue/recovery-referrals']`
  - Q: Does a recovery referral need maker-checker, validate the assessee has overdue arrears and notices served, and emit an audit event?
  - Verify: Open recovery-referrals route: preconditions on arrears/notice, approval state, audit. POST for an assessee with no arrears.
  - Test: Given assessee without overdue demand; when POST referral; then 422; given valid referral by officer A then status=pending until approver B; audit event emitted.
  - If wrong: Wrongful coercive action against a citizen; legal liability.
- [ ] **GAP-REVENUE-TRADE-LICENSES-02** (high, unverified-service-absent) `['GET /api/v1/revenue/trade-licenses (direct browser fetch)']`
  - Q: Is /api/v1/* reachable from the browser via a gateway/Next rewrite, or must the page use /api/proxy/v1/*?
  - Verify: Check apps/web next.config rewrites and the gateway ingress for /api/v1 in the deployed environment; run the page and curl https://<host>/api/v1/revenue/trade-licenses with a session cookie.
  - Test: Given the deployed web origin; when browser GET /api/v1/revenue/trade-licenses; then 200 JSON (not 404 HTML); e2e test on /revenue/trade-licenses lists rows.
  - If wrong: Page permanently shows the failure sentence; licences unmanageable.
- [ ] **GAP-REVENUE-ANALYTICS-04** (medium, unverified-service-absent) `['POST /api/v1/revenue/analytics/forecast (persist:true)']`
  - Q: Is persisting a forecast run restricted to an analytics/finance role and audited?
  - Verify: Open the forecast handler in revenue-service; check role guard for persist=true and audit emit. POST persist:true with a read-only role expecting 403.
  - Test: Given a read-only user; when POST forecast persist:true; then 403 and nothing stored; given authorised user then 201 plus audit event.
  - If wrong: Any user can write persisted records, polluting forecasts.
- [ ] **GAP-REVENUE-ASSESSEES-03** (medium, unverified-service-absent) `['POST /api/v1/revenue/assessees']`
  - Q: Does create reject a duplicate identifier (PAN/property id) with 409 and record purpose/consent for phone and email?
  - Verify: Open assessee create handler and DB unique index (tenantId, identifier); POST the same identifier twice and check status; check consent/purpose fields in the schema.
  - Test: Given an existing assessee id; when POST same identifier; then 409 with a problem+json code; and a created assessee carries consent purpose in audit event.
  - If wrong: Duplicate assessee records split demands; DPDP non-compliance for contact data.
- [ ] **GAP-REVENUE-HOME-01** (medium, unverified-service-absent) `['GET /api/v1/revenue/* (hub loaders)']`
  - Q: Do revenue-service endpoints enforce revenue roles/module entitlement themselves so a URL-typed hub cannot read data for users without them?
  - Verify: Open revenue-service auth hooks/policy registration; call each list endpoint with a token lacking revenue roles expecting 403.
  - Test: Given signed-in HR-only user; when GET /api/v1/revenue/assessees; then 403.
  - If wrong: Unauthorised staff read assessee financial and personal data.
- [ ] **GAP-REVENUE-INSTALMENTS-03** (medium, unverified-service-absent) `['POST /api/v1/revenue/instalments']`
  - Q: Does creating an instalment plan require approval by a second officer/role and audit the deferment?
  - Verify: Open instalments service: plan status lifecycle, approver rule, audit. Create plan as officer and check the demand's due date/state.
  - Test: Given officer creates a plan; when no approval; then plan=pending and demand due date unchanged; after approver then active with audit event.
  - If wrong: Unauthorised deferment of dues.

## location-service (9)

- [ ] **GAP-LOCATIONS-MAPS-MONITORING-01** (high, unverified-service-absent) `['GET /api/v1/locations/map-markers', 'GET /assets/:refId (asset route)']`
  - Q: Does map-markers return refType/refId that map to routable records, and does /assets/:refId accept an infrastructure refId?
  - Verify: Open location-service map-markers DTO; click each marker type in the running app and verify target opens the record.
  - Test: Given a geofence marker, when Open record clicked, then landing page shows that geofence; infrastructure refId resolves at /assets/:refId.
  - If wrong: Dead-end links from the monitoring map.
- [ ] **GAP-LOCATIONS-MAPS-MONITORING-02** (high, unverified-service-absent) `['GET /api/v1/locations/map-markers?domain&status&date|bbox']`
  - Q: Does map-markers honour a date (as-of) parameter, accept bbox, and cap results with total/truncated flag?
  - Verify: Open the map-markers query schema in location-service; curl with date=2020-01-01 and compare to no date; curl with bbox.
  - Test: Given markers created after 2021, when GET with date=2020-01-01, then they are excluded; response includes total > returned when capped.
  - If wrong: As-of view shows wrong state; unbounded payloads.
- [ ] **GAP-LOCATIONS-GEOFENCES-04** (medium, unverified-service-absent) `['GET /api/v1/geofences']`
  - Q: Does the gateway route /api/v1/geofences to location-service?
  - Verify: Open gateway registry.ts for a geofences prefix; curl /api/v1/geofences via gateway expecting 200 not 404.
  - Test: Given gateway running, when GET /api/v1/geofences with valid token, then 200 array from location-service.
  - If wrong: Geofences page permanently empty.
- [ ] **GAP-LOCATIONS-HOME-01** (medium, unverified-service-absent) `['GET /api/v1/locations', '/geofences', '/locations/map-markers']`
  - Q: Does location-service enforce role/entitlement checks so a basic employee token is rejected for master data and monitoring map?
  - Verify: Open location-service route preHandlers; curl GET /v1/locations/map-markers with employee JWT expecting 403.
  - Test: Given employee-role token, when GET geofences, then 403.
  - If wrong: Sensitive site/infrastructure data visible to every user.
- [ ] **GAP-LOCATIONS-INFRASTRUCTURE-04** (medium, unverified-service-absent) `['GET /api/v1/locations/infrastructure']`
  - Q: Is the static route /locations/infrastructure registered before /locations/:id so it is not captured as an id?
  - Verify: Open location-service router registration order; curl GET /v1/locations/infrastructure expecting an array, not 400/404 invalid id.
  - Test: When GET /locations/infrastructure, then 200 list, and GET /locations/:uuid still resolves.
  - If wrong: Infrastructure page always empty or errors.
- [ ] **GAP-LOCATIONS-JURISDICTIONS-04** (medium, unverified-service-absent) `['GET /api/v1/jurisdictions']`
  - Q: Does the gateway route /api/v1/jurisdictions to location-service?
  - Verify: Check gateway registry.ts; curl via gateway expecting 200.
  - Test: When GET /api/v1/jurisdictions, then 200 list.
  - If wrong: Jurisdictions page empty.
- [ ] **GAP-LOCATIONS-LIST-04** (medium, unverified-service-absent) `['POST /api/v1/locations', 'PATCH /api/v1/locations/:id/archive']`
  - Q: Does archive reject (409) when assets/employees still reference the location, require a reason, and audit both create and archive?
  - Verify: Open location-service archive handler; seed a location with a linked asset, curl PATCH archive expecting 409; inspect audit rows.
  - Test: Given location with 1 active asset, when PATCH archive with reason, then 409 IN_USE; with none, 200 and audit locations.archived with reason.
  - If wrong: Orphaned assets/employees pointing at an archived office.
- [ ] **GAP-LOCATIONS-MAPS-03** (medium, unverified-service-absent) `['POST /api/v1/locations/map-layers']`
  - Q: Does map-layers create validate sourceUrl (https only, host allow-list, type) and restrict to admin roles with audit?
  - Verify: Open map-layers create validator; curl POST sourceUrl 'http://evil.example/{z}/{x}/{y}.png' as admin expecting 422.
  - Test: Given http:// or javascript: URL, when POST layer, then 422; non-admin gets 403; success writes audit.
  - If wrong: Mixed content or hostile tile host injected into all users' maps.
- [ ] **GAP-HR-LOCATIONS-06** (low, unverified-service-absent) `['GET /api/v1/locations', 'POST /api/v1/locations (via /api/proxy/v1/locations)']`
  - Q: GET /v1/locations must admit every role in hr/layout.tsx HR_ROLES that lands on /hr/locations (at least hr_admin, hr_officer, manager, employee as intended) and POST must be limited to location_user, location_admin, super_admin, admin, hr_admin.
  - Verify: In the location-service repo open the route file for GET/POST /v1/locations and read requireRole lists; curl GET with tokens for hr_officer, manager, employee, location_user expecting the intended 200/403; curl POST as hr_officer expecting 403.
  - Test: Given a token with role hr_officer, when GET /v1/locations, then 200 with tenant rows; when POST /v1/locations then 403 FORBIDDEN; location_user POST then 202.
  - If wrong: Role mismatch hides locations from HR staff or lets unintended roles create sites.

## cdp-service (8)

- [ ] **GAP-CDP-STEWARD-01** (high, unverified-service-absent) `['GET /v1/cdp/steward/queue', 'POST /v1/cdp/steward/decide']`
  - Q: Does POST steward/decide enforce a steward role (403 otherwise) so non-stewards cannot merge profiles?
  - Verify: Open steward routes preHandler/requireRole; curl decide with a non-steward token expecting 403 and no state change.
  - Test: Given a non-steward token, when POST decide approve, then 403 and both profiles unchanged.
  - If wrong: Any user could merge customer profiles (data integrity, privacy); high.
- [ ] **GAP-CDP-EVENTS-05** (low, unverified-service-absent) `['GET /api/v1/cdp/events/taxonomy']`
  - Q: Does taxonomy return rows shaped {eventName, description, status} inside a {data} envelope with status limited to a fixed enum?
  - Verify: Open cdp-service events route/handler and its zod response schema; curl GET /v1/cdp/events/taxonomy with a viewer token and diff keys against mapper in apps/web/src/app/(app)/cdp/_data.ts:57-58.
  - Test: Given seeded taxonomy rows, when GET taxonomy as viewer, then 200 and every row has eventName, description, status (enum) and no extra PII fields.
  - If wrong: Page renders blank/wrong names if keys differ; low.
- [ ] **GAP-CDP-HOME-04** (low, unverified-service-absent) `['GET /api/v1/cdp/profiles', 'GET /api/v1/cdp/identity/anonymous-visitors', 'GET /api/v1/cdp/segments', 'GET /api/v1/cdp/events/taxonomy', 'GET/POST /v1/cdp/steward/queue|decide']`
  - Q: Do all five tile destinations map to live cdp-service routes that the tile viewer role may call?
  - Verify: List cdp-service route registrations; curl each of the five endpoints with the lowest CDP role and expect 200 (steward endpoints may be 403 for non-steward).
  - Test: Given a CDP viewer token, when each tile endpoint is called, then none returns 404/501; steward routes return 403 only for non-steward.
  - If wrong: Tiles lead to dead or forbidden pages; low.
- [ ] **GAP-CDP-IDENTITY-04** (low, unverified-service-absent) `['GET /api/v1/cdp/identity/anonymous-visitors?limit=']`
  - Q: Does anonymous-visitors require and cap limit, and return {visitorRef, firstSeenAt, lastSeenAt} only?
  - Verify: Open the visitors handler schema; curl without limit (expect 400) and with limit=100000 (expect capped/400).
  - Test: Given no limit, when GET visitors, then 400 VALIDATION; given limit above max, then 400 or clamped; rows contain no raw identifiers.
  - If wrong: Unbounded scan/DoS and identifier leakage; medium.
- [ ] **GAP-CDP-PROFILES-06** (low, unverified-service-absent) `['GET /api/v1/cdp/profiles']`
  - Q: Does the profile schema/ingest reject or mask Aadhaar and other government identifiers in the free-form attributes bag?
  - Verify: Open ingest validator and CDPProfile schema in @civitasone/schemas; POST an event with attributes.aadhaar=123412341234 and inspect stored/returned value.
  - Test: Given an ingest payload with a 12-digit Aadhaar in attributes, when stored and listed, then rejected or masked (last 4 only).
  - If wrong: DPDP/Aadhaar Act violation; high.
- [ ] **GAP-CDP-PROFILES-DETAIL-06** (low, unverified-service-absent) `['GET /api/v1/cdp/profiles/:id', 'GET /api/v1/cdp/identity/:id (encoded)']`
  - Q: Does profile/identity/timeline return a {data} envelope matching @civitasone/schemas CDPProfile, with 404 for unknown id and 403 for unauthorized viewers?
  - Verify: Open profile handler and compare response with schema package; curl unknown id and a low-role token.
  - Test: Given unknown id, when GET profile, then 404 with error envelope; given valid id, then body parses with CDPProfileSchema.
  - If wrong: Detail page crashes or shows partial PII; low.
- [ ] **GAP-CDP-SEGMENTS-05** (low, unverified-service-absent) `['GET /api/v1/cdp/segments']`
  - Q: What is the segment response shape and are create/update/delete endpoints present, role-gated and audited?
  - Verify: List cdp segments routes; curl GET and attempt POST/DELETE as viewer (expect 403) and as marketer (expect 2xx plus audit row).
  - Test: Given viewer token, when POST segment, then 403; given editor, then 201 and an audit entry is written.
  - If wrong: Unaudited or open audience mutation; medium.
- [ ] **GAP-CDP-STEWARD-06** (low, unverified-service-absent) `['POST /v1/cdp/steward/decide', 'steward/consumer.ts (queue)']`
  - Q: Does approve merge profiles atomically, write an audit record with decider identity, and forbid the requester from being the sole approver?
  - Verify: Open steward/consumer.ts and decide handler; run an approve and inspect merged profile, tombstone and audit rows; test double-submit.
  - Test: Given a pending pair, when approve twice, then one merge, one audit row, second call idempotent; reject leaves both intact.
  - If wrong: Irreversible wrong merges without audit trail; high.

## notification-service (8)

- [ ] **GAP-NOTIFICATIONS-CAMPAIGNS-DETAIL-01** (high, unverified-service-absent) `['PATCH notification/campaigns/:id/send', 'PATCH .../cancel']`
  - Q: Does send require an approver role distinct from the creator, check consent/DND/opt-out per recipient, and audit with audience size?
  - Verify: Open notification-service campaigns send handler; curl PATCH send as creator expecting 403 if maker-checker; verify opt-out filtering in audience builder.
  - Test: Given recipient with marketing opt-out, when campaign sent, then no message queued for them; sender=creator gets 403.
  - If wrong: DPDP consent breach and irreversible mass send.
- [ ] **GAP-NOTIFICATIONS-COMPOSE-01** (high, unverified-service-absent) `['POST notification/send', 'GET notification/templates']`
  - Q: Does send restrict roles, cap recipients, rate-limit per user and audit each send?
  - Verify: Open notification-service send handler; curl POST with employee JWT expecting 403; loop 100 requests expecting 429.
  - Test: Given employee token, when POST send, then 403; admin over quota gets 429; success writes audit with recipient+template.
  - If wrong: Internal spam/phishing vector.
- [ ] **GAP-NOTIFICATIONS-EXPERIMENTS-01** (high, unverified-service-absent) `['GET/POST notification experiments (approve-winner)']`
  - Q: Does the service expose approve/reject-winner endpoints with role separation from the experiment creator?
  - Verify: Grep notification-service for approve-winner; curl as creator and as approver.
  - Test: Given awaiting-approval experiment, when creator approves, then 403; approver gets 200 and audit.
  - If wrong: Winner promotion cannot be actioned; maker-checker not enforced.
- [ ] **GAP-NOTIFICATIONS-DELIVERIES-03** (medium, unverified-service-absent) `['GET notification/deliveries', 'GET notification/deliveries/:id']`
  - Q: Do list and detail use the same attempt counter field (attemptCount vs retryCount)?
  - Verify: Compare DTOs in notification-service; curl both for one failed delivery.
  - Test: Given delivery retried twice, when GET list and detail, then both report the same attempts number under same key.
  - If wrong: Support sees contradictory retry counts.
- [ ] **GAP-NOTIFICATIONS-TEMPLATES-DETAIL-02** (medium, unverified-service-absent) `['GET notification/templates/:id/versions']`
  - Q: Does versions endpoint return newest first with explicit version numbers?
  - Verify: Open versions query ORDER BY; curl for template with 3 versions.
  - Test: Given versions 1..3, when GET versions, then first item version=3.
  - If wrong: Old body shown and sent as current.
- [ ] **GAP-CHANGE-COMMS-05** (low, unverified-service-absent) `['(none in web) admin change events -> notification-service']`
  - Q: Is the comms text true: does an approved/scheduled change actually enqueue notifications to stakeholders?
  - Verify: Open admin-service change transition handlers for publish to the queue and notification-service consumer; approve a change and check the outbox.
  - Test: Given a change is scheduled, when transition completes, then a notification job is enqueued per stakeholder and delivery is logged.
  - If wrong: Page promises notifications that never go out; medium.
- [ ] **GAP-TENANT-ADMIN-NOTIFICATIONS-06** (low, unverified-service-absent) `['GET /api/notification/preferences (loaders.ts:4335)', 'PATCH /api/proxy/notification/prefs/:id (NotificationPrefActions.tsx:82)']`
  - Q: Does PATCH /prefs/:id accept the body web sends (enabled flag), validate with zod, enforce tenant/user ownership and emit an audit event?
  - Verify: Open notification-service prefs route; compare zod body with NotificationPrefActions payload; PATCH another tenant's id expecting 404.
  - Test: Given pref id of tenant B, when tenant A admin PATCHes it, then 404 and no change; valid patch returns updated row and emits audit event.
  - If wrong: Cross-tenant preference tampering; silent notification suppression.
- [ ] **GAP-TENANT-ADMIN-NOTIFICATIONS-CHANNELS-05** (low, unverified-service-absent) `['GET /api/notification/channels (channels/page.tsx:21)']`
  - Q: What are the possible channel status values (active, degraded, disabled, unconfigured)?
  - Verify: Open notification-service channels DTO/enum; list channels with a failing provider.
  - Test: Given an SMS channel with invalid credentials, when listed, then status=error/degraded not active.
  - If wrong: Broken delivery channel appears healthy.

## stock-service (8)

- [ ] **GAP-STOCK-DASHBOARD-06** (medium, unverified-service-absent) `['GET /api/v1/stock/dashboard']`
  - Q: Is inventoryValue returned in paise (minor units) as an integer?
  - Verify: Open stock-service dashboard handler and value computation (sum of qty*rate column type); curl and compare with a known ledger.
  - Test: Given one item qty 10 at Rs 5.00; when GET dashboard; then inventoryValue===5000 (paise).
  - If wrong: 100x value misstatement on the dashboard.
- [ ] **GAP-STOCK-LEDGER-NEW-04** (medium, unverified-service-absent) `['POST /api/proxy/v1/stock/entries']`
  - Q: Does stock-service accept a structured reason field and emit an audit event containing it, rather than parsing 'Reason:' from notes?
  - Verify: Open the stock entries schema (zod) and audit emission; check for reason/reasonCode column.
  - Test: Given POST entry with reason; when saved; then audit event stock.entry.created has reason field; missing reason for adjustment types returns 422.
  - If wrong: Audit trail unusable for stock-adjustment investigations.
- [ ] **GAP-STOCK-LIST-04** (medium, unverified-service-absent) `['GET /api/v1/stock/items']`
  - Q: Is totalValue in paise as an integer for every item?
  - Verify: Open stock-service item DTO and value column types; curl items and compare with the ledger.
  - Test: Given item worth Rs 100.00; when GET items; then totalValue===10000.
  - If wrong: 100x misstatement of stock value.
- [ ] **GAP-INVENTORY-DETAIL-05** (low, unverified-service-absent) `['GET /api/v1/stock/items/{id}']`
  - Q: GET /v1/stock/items/:id must return unitCost and totalValue as integer minor units (paise) so formatMoney (which divides by 100) is correct, and must return 404 (not 200 empty) for unknown ids.
  - Verify: Open stock-service item detail handler and apiMappers.ts:1017-1018 (parseMinor(unitCost), parseMinor(totalValue)); curl GET /v1/stock/items/{id} for an item costing Rs 12.50 expecting unitCost 1250; curl unknown id expect 404.
  - Test: Given an item with rate Rs 12.50 x 10 units, when GET item detail then unitCost=1250 and totalValue=12500 (minor units); unknown id gives 404 NOT_FOUND.
  - If wrong: Costs shown 100x too big/small in a financial valuation screen.
- [ ] **GAP-INVENTORY-LIST-04** (low, unverified-service-absent) `['GET /api/v1/stock/items']`
  - Q: GET /v1/stock/items must return isLowStock and totalValue as consistent minor-unit integers computed server-side (or onHand/reorderLevel so the client can), so summing totalValue across rows is safe.
  - Verify: Open stock-service items list handler and apiMappers.ts:356 (totalValue number or parseMinor); curl GET /v1/stock/items and assert totalValue is an integer paise value and isLowStock boolean for every row.
  - Test: Given items with totalValue 12500 and 7500 paise, when list, then values are integers and page sum equals 20000 -> Rs 200.00; isLowStock true iff onHand<=reorderLevel.
  - If wrong: Wrong stock valuation total on the dashboard; float drift.
- [ ] **GAP-INVENTORY-LIST-05** (low, unverified-service-absent) `['GET /api/v1/stock/items', 'GET /api/v1/inventory/cycle-counts?status=pending_approval&limit=200']`
  - Q: stock-service and inventory-service list endpoints must both require an authorised role, tenant-scope and paginate, and their ids/units must agree since the page merges them.
  - Verify: Open both services' list handlers; curl each with inventory role (200), no role (403); compare item ids between stock/items and inventory cycle-count rows.
  - Test: Given same tenant, when both endpoints are called, then item ids referenced by cycle counts exist in stock/items and 403 is returned without the role.
  - If wrong: Inconsistent stock views; unauthorised read.
- [ ] **GAP-INVENTORY-RECONCILE-05** (low, unverified-service-absent) `['GET /api/v1/stock/ledger', 'GET /api/v1/inventory/ledger?limit=200']`
  - Q: GET /v1/stock/ledger must apply a server-side default and maximum limit (with pagination) when the client sends none, and stock and inventory ledgers must agree on quantities for the same movements.
  - Verify: Open stock-service ledger handler (web loader loaders.ts:3907 sends no limit); seed >5000 movements and curl GET /v1/stock/ledger, expect at most default page size and hasMore; compare a movement's quantity with inventory ledger.
  - Test: Given 10,000 ledger rows, when GET /v1/stock/ledger without limit, then <=200 rows and pagination.hasMore=true; same movement id has identical quantity in both services.
  - If wrong: Unbounded response can time out or exhaust memory; reconciliation compares different sets.
- [ ] **GAP-STOCK-HOME-06** (low, unverified-service-absent) `['GET /api/v1/stock/dashboard', 'GET /api/v1/stock/items']`
  - Q: Do the stock endpoints behind /stock exist with the shapes the loaders assume, and enforce stock roles?
  - Verify: Open stock-service routes; run contract tests from web zod schemas against responses; call with a role lacking stock access.
  - Test: Given a stock-less user; when GET /api/v1/stock/items; then 403; given valid role then 200 matching schema.
  - If wrong: Hub renders empty/false data or leaks inventory.

## contract-service (7)

- [ ] **GAP-CONTRACTS-DETAIL-07** (low, unverified-service-absent) `['GET /v1/contract/contracts/:id(/milestones|/bonds)', 'POST .../milestones/:mid/:kind', 'POST .../bonds/:bid/transition', 'POST .../submit-approval', 'contracts/consumer.ts']`
  - Q: Are SLA penalty computation, bond/milestone transitions and audit correct and enforced server-side?
  - Verify: Open contract-service consumer and transition handlers; run penalty unit tests with late milestone.
  - Test: Given a milestone 10 days late with 0.5%/day cap 10%, when penalty computed, then equals expected and audit row written.
  - If wrong: Wrong penalties/payments on public contracts; high.
- [ ] **GAP-CONTRACTS-HOME-05** (low, unverified-service-absent) `['GET /api/v1/contract/contracts', 'GET /v1/contract/obligations']`
  - Q: Which roles may list contracts and obligations, and is list scoped by department?
  - Verify: Open list route guards; curl with out-of-department token.
  - Test: Given user of dept A, when GET contracts, then only dept A rows unless privileged.
  - If wrong: Cross-department contract disclosure; medium.
- [ ] **GAP-CONTRACTS-LIST-05** (low, unverified-service-absent) `['GET /api/v1/contract/contracts']`
  - Q: Does list return the fields mapContractsListRows expects (number, title, vendor, value, status) with paging?
  - Verify: Compare handler schema with mapper in _data/loaders.ts.
  - Test: Given 3 contracts, when GET list, then each has all mapped fields and stable pagination.
  - If wrong: Blank columns; low.
- [ ] **GAP-CONTRACTS-NEW-05** (low, unverified-service-absent) `['POST /v1/contract/contracts']`
  - Q: Does create reject duplicate contract numbers (409) and audit the mutation?
  - Verify: POST the same contractNo twice; inspect audit table.
  - Test: Given existing contractNo, when POST again, then 409 DUPLICATE_NUMBER; success writes audit.
  - If wrong: Duplicate contracts; medium.
- [ ] **GAP-CONTRACTS-NEW-06** (low, unverified-service-absent) `['POST /v1/contract/contracts']`
  - Q: Does the route validate the body with zod (dates, amounts in minor units, enums) returning 400 envelope, and audit create?
  - Verify: Open create route schema; POST invalid dates/negative value.
  - Test: Given end date before start date, when POST, then 400 with field errors; valid POST creates audit row.
  - If wrong: Bad contract data persisted; medium.
- [ ] **GAP-PROCUREMENT-CONTRACTS-05** (low, unverified-service-absent) `['GET /api/v1/contract/contracts']`
  - Q: Does the list return poRef and is it tenant-scoped and role-limited?
  - Verify: Open contract-service list route; inspect response fields and guard.
  - Test: Given tenant A/B contracts, when tenant A lists, then only A rows including poRef.
  - If wrong: Cross-tenant leak; missing PO linkage.
- [ ] **GAP-PROCUREMENT-CONTRACTS-NEW-06** (low, unverified-service-absent) `['POST /api/v1/contract/contracts']`
  - Q: Contract create must emit audit, enforce unique contract number per tenant, and validate poRef against an existing PO (by API, not FK).
  - Verify: Open contract-service create handler; POST duplicate number and unknown poRef.
  - Test: Given existing contract C-1, when POST C-1 again, then 409; unknown poRef then 422.
  - If wrong: Duplicate or unlinked contracts.

## policy-service (6)

- [ ] **GAP-ADMIN-ROLE-FEATURES-01** (high, unverified-service-absent) `GET/PUT /api/v1/policy/role-features`
  - Q: Does policy-service return 403 on GET/PUT /api/v1/policy/role-features for any caller lacking super_admin/platform_admin (and scope tenant data to the caller's tenant), regardless of the web page having no gate?
  - Verify: In policy-service repo open the route file registering GET/PUT /api/v1/policy/role-features and confirm a preHandler/requireRole guard; then curl it with a JWT of a plain tenant user (e.g. employee) and expect 403, with a super_admin JWT expect 200.
  - Test: Given a JWT with role=employee, when GET/PATCH GET/PUT /api/v1/policy/role-features, then 403 and no body data; given super_admin, then 200.
  - If wrong: Any signed-in user reads or changes platform-operator data (privilege escalation / cross-tenant exposure).
- [ ] **GAP-POLICY-HOME-01** (high, unverified-service-absent) `['POST /api/v1/policy/bindings', 'role features endpoints']`
  - Q: Binding creation must require a policy/tenant admin role and forbid self-escalation (granting oneself a higher role); audit each grant.
  - Verify: Open policy-service bindings POST; curl as employee granting own id role tenant_admin expecting 403.
  - Test: Given employee JWT, when POST bindings for own id, then 403; admin grants emit audit.
  - If wrong: Privilege escalation by any signed-in user.
- [ ] **GAP-POLICY-BINDINGS-03** (medium, unverified-service-absent) `['GET /api/v1/policy/bindings', 'POST /api/v1/policy/bindings']`
  - Q: GET /v1/policy/bindings must exist and return the documented list shape; a 404 must not occur.
  - Verify: Grep policy-service routes for 'bindings' GET; curl GET with admin token expecting 200 array.
  - Test: Given admin JWT, when GET policy/bindings, then 200 with array of {id,userId,role,status}.
  - If wrong: Bindings page permanently shows error state.
- [ ] **GAP-POLICY-EVALUATE-05** (low, unverified-service-absent) `['POST /api/v1/policy/evaluate']`
  - Q: Does evaluate emit an audit/decision-log event, and is it restricted to policy admins?
  - Verify: Open the evaluate handler; grep for audit emission. Call and inspect audit stream.
  - Test: Given admin JWT, when POST evaluate, then a decision-log event with subject, action, decision is recorded.
  - If wrong: Authorisation probing untraceable.
- [ ] **GAP-TENANT-ADMIN-ROLES-06** (low, unverified-service-absent) `['POST /api/proxy/policy/roles (RolesTable.tsx:121)', 'GET /api/policy/roles']`
  - Q: Does POST /roles enforce unique name per tenant (409), create with zero permissions by default, and emit an audit event?
  - Verify: Open policy-service roles route and DB unique index (tenantId,name); POST same name twice.
  - Test: Given role 'Auditor' exists, when POST name 'auditor', then 409 and no row; new role has no permissions and audit role.created is emitted.
  - If wrong: Duplicate roles cause ambiguous access grants; new roles accidentally over-privileged.
- [ ] **GAP-TENANT-ADMIN-ROLES-DETAIL-06** (low, unverified-service-absent) `['GET /api/policy/roles/:id', 'POST /api/proxy/policy/roles/:id/permissions (PermissionGrid.tsx:91)']`
  - Q: Can a permission's module/action contain ':' and does Perm carry a resource field that must be part of the grant key?
  - Verify: Open policy-service permission schema/seed; grep for ':' in module/action names; check whether resource is used in authorization decisions.
  - Test: Given permission {module:'a:b',action:'read',resource:'x'}, when grid saves, then server stores exact module, action, resource unchanged.
  - If wrong: Wrong permissions granted/dropped when keys split incorrectly: privilege escalation or lockout.

## workflow-service (6)

- [ ] **GAP-WORKFLOW-DEFINITIONS-02** (high, unverified-service-absent) `['GET /api/v1/workflow/definitions', 'GET /api/v1/workflow/templates']`
  - Q: Does GET /v1/workflow/definitions return items with id, name, module, triggerEvent, steps (count), status, version (page.tsx:6-14) as well as code/description used by workflowData.ts:107-131?
  - Verify: Open the definitions list handler and its response schema in workflow-service; curl GET /api/v1/workflow/definitions as a workflow admin and diff the keys against page.tsx Definition and workflowData.ts mapper.
  - Test: Given a seeded definition, when GET /v1/workflow/definitions, then each item has module, triggerEvent, steps as number, status, version (contract test shared with web fixtures).
  - If wrong: Module and Trigger columns render blank; admins cannot tell definitions apart.
- [ ] **GAP-WORKFLOW-DESIGNER-02** (high, unverified-service-absent) `['GET /api/v1/workflow/designer/definitions?pageSize=100', 'GET /api/v1/workflow/designer/definitions/:id']`
  - Q: Do the designer definitions endpoints exist, return a stable list shape, and require a designer role rather than any authenticated user?
  - Verify: Open designer routes in workflow-service; curl the list as designer and as plain user (expect 403 for the latter) and note the body shape vs designerData.ts:77-100.
  - Test: Given a user without designer role, when GET designer/definitions, then 403; given designer, then 200 {data:[{id,name,version}]}.
  - If wrong: Designer shows a false failure badge or exposes unpublished workflow definitions to non-designers.
- [ ] **GAP-WORKFLOW-HOME-01** (high, unverified-service-absent) `['GET /api/v1/workflow/analytics/summary']`
  - Q: Is analytics/summary scoped to the caller's tenant and role (or restricted to workflow admins), or does it return tenant-wide figures to every authenticated user?
  - Verify: Open the analytics summary handler in workflow-service; curl as a plain employee and as a workflow admin and compare counts and the required-role preHandler.
  - Test: Given a user with no workflow role, when GET analytics/summary, then 403 (or only own-scope counts); given admin, then tenant-wide counts.
  - If wrong: Information disclosure of tenant-wide workload and SLA metrics to all users.
- [ ] **GAP-WORKFLOW-MY-TASKS-01** (high, unverified-service-absent) `['POST /v1/workflow/tasks/:id/complete', 'POST /v1/workflow/tasks/:id/claim', 'GET /v1/workflow/tasks']`
  - Q: Does complete reject (403/409) when the task is claimed by another assignee, when actor is not in the task's role group, and when actor equals the maker (maker-checker)?
  - Verify: Open the task complete handler in workflow-service; curl complete as user B on a task claimed by A (expect 409/403) and as the maker (expect 403 with distinct code).
  - Test: Given task claimed by A, when B posts complete approve, then 409 TASK_CLAIMED; given maker==actor, then 403 MAKER_CHECKER; given assignee, then 200 and audit row.
  - If wrong: Maker approves own submission or overrides another officer: segregation-of-duties breach.
- [ ] **GAP-PROCUREMENT-APPROVALS-ESCALATION-01** (medium, unverified-service-absent) `['(none; ESCALATION_ROWS hard-coded in page)', 'approval routing config']`
  - Q: Do the workflow-service procurement approval thresholds and escalation times equal ESCALATION_ROWS, and are they per-tenant configurable?
  - Verify: Open the workflow routing config for procurement approvals and diff against escalation/page.tsx:13-17.
  - Test: Given seeded workflow, when comparing thresholds to page rows, then every band and authority matches (snapshot test).
  - If wrong: Reference misstates delegation of financial powers.
- [ ] **GAP-WORKFLOW-HOME-04** (medium, unverified-service-absent) `['GET /api/v1/workflow/analytics/summary']`
  - Q: Does slaBreachRate come back as a 0-1 fraction (not percent) and are all metrics always present in the payload?
  - Verify: Read the analytics handler/schema for slaBreachRate; curl with 63 breached of 100 and confirm 0.63; test a tenant with no data returns explicit zeros.
  - Test: Given 63/100 breached tasks, when GET analytics/summary, then slaBreachRate == 0.63; given empty tenant, then all fields present and numeric.
  - If wrong: Breach rate printed as 6300% or a false clean 0.0%, hiding SLA failures.

## project-service (6)

- [ ] **GAP-PROJECTS-BENEFICIARIES-03** (medium, unverified-service-absent) `['GET /api/v1/projects/beneficiaries']`
  - Q: Does the response give disbursement as integer paise (or documented unit), a beneficiary name, and a schema-validated shape?
  - Verify: Open the beneficiaries handler and response schema; curl and inspect types and units.
  - Test: Given a beneficiary with 1,25,000 rupees, when listed, then disbursementMinor=12500000 and name is present.
  - If wrong: Wrong amounts displayed to finance users.
- [ ] **GAP-PROJECTS-DELAY-ANALYSIS-03** (medium, unverified-service-absent) `['GET /api/v1/projects/delay-analysis']`
  - Q: Are planned/forecast deadlines ISO 8601 dates and delayDays computed server-side consistently?
  - Verify: Open the delay handler; curl and check date formats and delayDays vs dates.
  - Test: Given deadline 2026-03-01 and forecast 2026-03-11, when listed, then delayDays=10 and dates are ISO.
  - If wrong: Wrong sort order and wrong delays.
- [ ] **GAP-PROJECTS-DPR-TRACKING-02** (medium, unverified-service-absent) `['GET /api/v1/projects/dprs']`
  - Q: In which unit is estimatedCost returned (paise, rupees or crore) and is it numeric?
  - Verify: Open the DPR handler/schema; curl and compare with project budget units.
  - Test: Given a DPR of 12.5 crore, when listed, then estimatedCostMinor=12500000000 (paise).
  - If wrong: Order-of-magnitude errors in cost display.
- [ ] **GAP-PROJECTS-HOME-02** (medium, unverified-service-absent) `['/api/v1/project/*', '/api/v1/projects/*', '/api/proxy/v1/projects/*']`
  - Q: Does the gateway route both /project/* and /projects/* prefixes to project-service, or is only one canonical?
  - Verify: Open the gateway route table and project-service route registration; curl both prefixes for dashboard.
  - Test: Given GET /api/v1/project/dashboard and /api/v1/projects/dashboard, then both return 200 or one returns 404 documenting canonical prefix.
  - If wrong: One set of pages silently returns empty data (fallback []).
- [ ] **GAP-PROJECTS-NEW-03** (medium, unverified-service-absent) `['POST /api/proxy/v1/projects']`
  - Q: Does project creation require a role such as project_manager, validate input with zod and emit audit?
  - Verify: Open the POST handler; call with a viewer token expecting 403 and check audit emit.
  - Test: Given a viewer token, when POST /projects, then 403 and no row.
  - If wrong: Unauthorised projects and budgets.
- [ ] **GAP-PROJECTS-WBS-03** (medium, unverified-service-absent) `['GET /api/v1/projects/wbs']`
  - Q: Does each WBS node include projectId/projectCode and does the endpoint accept a projectId filter?
  - Verify: Open the WBS handler and response; curl and check node fields.
  - Test: Given nodes from two projects, when listed, then each node has projectId.
  - If wrong: Cannot trace tasks to projects.

## theme-service (6)

- [ ] **GAP-SETTINGS-BRANDING-03** (high, unverified-service-absent) `['GET/PUT /api/proxy/v1/themes/brand', 'GET /api/proxy/v1/themes/brand/presets']`
  - Q: Does PUT /v1/themes/brand require a tenant-admin role and emit an audit event with before/after?
  - Verify: Open theme-service brand route: role guard and audit emit. PUT as a non-admin token expecting 403.
  - Test: Given non-admin user; when PUT brand config; then 403 and no change; given admin then 200 and audit event brand.updated with diff.
  - If wrong: Any user can deface tenant branding (phishing/reputation).
- [ ] **GAP-THEMES-HOME-01** (high, unverified-service-absent) `['GET /api/v1/themes/tokens', 'POST /api/proxy/v1/themes/publish (ThemeActions.tsx:19)']`
  - Q: Does theme-service require an admin role on publish (and all themes routes) independent of the web UI?
  - Verify: Open theme-service publish route preHandler and policy; POST publish as employee token.
  - Test: Given a non-admin token, when POST /v1/themes/publish, then 403 and no revision created or audit event of success.
  - If wrong: Any user can publish a tenant-wide irreversible theme.
- [ ] **GAP-THEMES-TOKENS-02** (high, unverified-service-absent) `['POST /api/proxy/v1/themes/publish body {name, reason} (ThemeActions.tsx:19-23)', 'GET /api/v1/themes/tokens']`
  - Q: What exactly does publish promote (draft token set id/version), is it role-restricted, maker-checker enforced (approver != requester) and audited with the reason?
  - Verify: Open theme-service publish handler: how it selects the draft, whether it takes revisionId/expectedVersion, approver check, audit emit.
  - Test: Given draft v3 edited after the user loaded page, when publish without expectedVersion, then server rejects (409) or publishes the pinned v3; requester approving own change gives 403; audit includes reason.
  - If wrong: Irreversible tenant-wide theme change of unintended content by any user.
- [ ] **GAP-THEMES-BRAND-05** (medium, unverified-service-absent) `['GET /api/v1/themes/brand (themes/_data.ts:91)']`
  - Q: Does theme-service restrict brand reads/writes to tenant_admin (or theme editor role) and reject others with 403?
  - Verify: Open theme-service brand route preHandler; curl as plain employee and tenant_admin.
  - Test: Given employee token, when GET/PUT /v1/themes/brand write, then 403; tenant_admin 200 tenant-scoped.
  - If wrong: Any signed-in user can view/alter tenant branding.
- [ ] **GAP-THEMES-BRANDING-05** (medium, unverified-service-absent) `['GET /api/v1/themes/branding (themes/_data.ts:90)']`
  - Q: Does theme-service restrict branding endpoints to authorised admin roles?
  - Verify: Open theme-service branding route guard; curl as employee (403) and tenant_admin (200).
  - Test: Given employee token, when hitting /v1/themes/branding mutation, then 403.
  - If wrong: Unauthorised tenant re-branding.
- [ ] **GAP-THEMES-TEMPLATES-04** (medium, unverified-service-absent) `['GET /api/v1/themes/templates (themes/_data.ts:89)']`
  - Q: Does theme-service gate template routes by role?
  - Verify: Open theme-service templates routes; curl as employee and admin.
  - Test: Given employee token, when mutating templates, then 403.
  - If wrong: Unauthorised template changes.

## telephony-service (6)

- [ ] **GAP-TELEPHONY-LIST-04** (medium, unverified-service-absent) `['GET /api/v1/telephony/calls (server, loaders.ts:1821)', 'GET /api/proxy/v1/telephony/calls (client, resource.ts:103)']`
  - Q: Do both gateway paths reach the same telephony-service /v1/telephony/calls route with identical auth and shape?
  - Verify: Check the gateway route table and telephony-service route; curl both paths with the same token and diff responses.
  - Test: Given same token; when GET both paths; then identical JSON body and same 403 behaviour for unauthorised users.
  - If wrong: Inconsistent call lists between pages.
- [ ] **GAP-TELEPHONY-AGENTS-07** (low, unverified-service-absent) `['GET /v1/telephony/agents']`
  - Q: Does the agents endpoint return {data:[{...}]} with the fields AgentRow expects, tenant-scoped and role-guarded?
  - Verify: Open telephony-service agents route and DTO; curl with a token and diff against AgentRow in agents/page.tsx.
  - Test: Given tenant with 2 agents; when GET agents; then data length 2 with all AgentRow fields; other tenant's agents absent.
  - If wrong: Wrong or missing agent data; cross-tenant leak.
- [ ] **GAP-TELEPHONY-CALLS-08** (low, unverified-service-absent) `['GET /v1/telephony/calls']`
  - Q: What are the call lifecycle status values and how is SLA computed (threshold, field)?
  - Verify: Open telephony-service call status enum and any SLA config; compare with calls/page.tsx status and SLA logic.
  - Test: Given calls in each status and a call breaching threshold; when GET calls; then status values match the enum and sla flag equals server rule.
  - If wrong: Wrong SLA reporting to supervisors.
- [ ] **GAP-TELEPHONY-DISPOSITIONS-07** (low, unverified-service-absent) `['GET /v1/telephony/calls']`
  - Q: What disposition codes exist and is the finished-call status literally 'completed'?
  - Verify: Open telephony-service disposition enum and call status enum.
  - Test: Given calls with each disposition; when GET calls; then dispositions belong to the enum and completed calls have status 'completed'.
  - If wrong: Disposition report counts wrong or empty.
- [ ] **GAP-TELEPHONY-HOME-05** (low, unverified-service-absent) `['GET /v1/telephony/*']`
  - Q: Do the routes behind the telephony hub exist and enforce a telephony role and tenant scope?
  - Verify: Open telephony-service route registration; call each hub endpoint with an unauthorised role expecting 403.
  - Test: Given user without telephony role; when GET /v1/telephony/calls; then 403.
  - If wrong: Call data exposed to unauthorised staff.
- [ ] **GAP-TELEPHONY-LIST-06** (low, unverified-service-absent) `['GET /api/v1/telephony/calls']`
  - Q: Does each row contain the fields the list renders (id, direction, agent, status, duration, timestamp)?
  - Verify: Open telephony-service call DTO; run web ModuleList mapper against a live response.
  - Test: Given a call; when GET calls; then row has all mapper fields non-null-or-documented.
  - If wrong: Blank columns in the list.

## meeting-service (5)

- [ ] **GAP-MEETING-ADMIN-02** (high, unverified-service-absent) `['POST /api/v1/meeting/config', 'POST /api/v1/meeting/config/presets/:preset', 'GET /api/v1/meeting/config/:ns']`
  - Q: Does config write require an admin role and write an audit row with before/after per setting?
  - Verify: Open meeting-service config routes (/v1/meetings/config); curl POST with normal user JWT expecting 403; check audit table.
  - Test: Given non-admin token, when POST config, then 403; given admin, then 200 and audit meeting.config.updated with old/new value.
  - If wrong: Any user can change tenant meeting policy unaudited.
- [ ] **GAP-MEETING-MEETINGS-MEETINGID-03** (high, unverified-service-absent) `['POST /api/v1/meeting/:id/transition', '/attendance/check-in', '/votes/cast', '/votes/:rid/conclude']`
  - Q: Are lifecycle, cast and conclude restricted to the right roles (chair/secretary, eligible voter once) with audit?
  - Verify: Open meeting-service handlers; curl transition as attendee expecting 403; cast twice as same voter expecting 409.
  - Test: Given non-member, when cast, then 403; duplicate cast gives 409; conclude by non-chair gives 403; each success audited.
  - If wrong: Vote tampering or unauthorised meeting state changes.
- [ ] **GAP-MEETING-HOME-02** (medium, unverified-service-absent) `['GET /api/v1/meeting']`
  - Q: Does the list endpoint paginate with a default limit, and does it return total or support status filter/count?
  - Verify: Open meeting-service list handler; curl GET with 150 seeded meetings and check length and meta.total.
  - Test: Given 150 meetings, when GET list, then response includes total=150 (or all are returned); status=in_progress filter honoured.
  - If wrong: Wrong headline counts.
- [ ] **GAP-MEETING-MEETINGS-03** (medium, unverified-service-absent) `['POST /api/v1/meeting']`
  - Q: Which roles may create a meeting (secretariat only?) and what is the 403 body?
  - Verify: Open meeting-service create route guard; curl POST as employee.
  - Test: Given employee token, when POST meeting, then 403 (or 201 if open policy documented).
  - If wrong: Confusing 403 for ordinary users.
- [ ] **GAP-MEETING-MEETINGS-MEETINGID-MINUTES-03** (medium, unverified-service-absent) `['POST /api/v1/meeting/:id/minutes/:minutesId/approve', 'POST .../reject']`
  - Q: Does approve/reject enforce chairperson-only and drafter-excluded, return a coded 403, and audit?
  - Verify: Open meeting-service minutes approve handler; curl approve as drafter and as secretary expecting 403; as chair expecting 200.
  - Test: Given drafter token, when approve, then 403 with code; chair approve writes audit meeting.minutes.approved.
  - If wrong: Self-approval of minutes; legal record integrity.

## report-service (5)

- [ ] **GAP-REPORTS-LIST-NEW-02** (high, unverified-service-absent) `['POST /api/proxy/v1/reports/jobs', 'GET /api/v1/reports/report-jobs']`
  - Q: Does the gateway map /reports/jobs to the same resource as /reports/report-jobs, and is the POST role-checked and audited?
  - Verify: Open the report-service routes and gateway map; POST /reports/jobs with a valid token, then GET report-jobs and confirm the job appears; check audit emit.
  - Test: Given POST /reports/jobs, when GET /reports/report-jobs, then the created job is listed and an audit event exists.
  - If wrong: Created reports never appear or run unaudited exports of sensitive data.
- [ ] **GAP-REPORTS-SCHEDULED-02** (high, unverified-service-absent) `['GET /v1/reports/scheduled (fetchJson)', 'POST /api/v1/reports/scheduled (NewScheduledForm)']`
  - Q: Are the read and create paths the same resource on the gateway, and does create validate recipients with zod, restrict to authorised roles and emit an audit event?
  - Verify: Check the gateway route table for both prefixes; open report-service scheduled route: role guard, zod recipients schema, audit emission (@civitasone/events). POST with role lacking reports.schedule and expect 403.
  - Test: Given a user with reports.schedule; when POST scheduled with external email recipient; then 201, row visible in GET, and audit event scheduled_report.created is emitted with recipients masked.
  - If wrong: DPDP exposure: reports mailed to arbitrary addresses with no trail; or created rows never listed.
- [ ] **GAP-REPORTS-LIST-04** (medium, unverified-service-absent) `['GET /api/v1/reports/report-jobs']`
  - Q: Is downloadUrl a short-lived signed URL issued only to the job owner/authorised role, with download audited and PII exports DPDP-controlled?
  - Verify: In report-service open the report-jobs handler and the URL signer; check TTL, tenantId/owner check, audit emit. curl the list as user A, then GET the returned downloadUrl as user B and after TTL.
  - Test: Given completed job owned by A with signed URL; when B (same tenant, no report role) or anyone after expiry requests it; then 403/410 and a download audit event exists for A's fetch.
  - If wrong: Data leak: exported personal data downloadable by unauthorised or via stale links.
- [ ] **GAP-REPORTS-MIS-03** (medium, unverified-service-absent) `['GET /api/v1/reports/mis']`
  - Q: Does each MIS metric declare its unit (INR paise vs rupees vs count vs percent) so the web can format it?
  - Verify: Open the MIS handler in report-service; check the metric DTO for value/unit fields and whether money metrics are minor units. curl /api/v1/reports/mis and inspect money rows.
  - Test: Given a money metric of Rs 1,25,000; when GET mis; then unit==='INR_PAISE' (or documented) and value is integer 12500000.
  - If wrong: Financial misreporting: a 100x error on management dashboards.
- [ ] **GAP-REPORTS-LIST-05** (low, unverified-service-absent) `['GET /api/v1/reports/report-jobs']`
  - Q: Which status values can a report job take (queued, running, completed, failed, cancelled) and does the API return exactly that set?
  - Verify: Open report-service job schema/enum (zod + drizzle enum); compare with StatusPill map (StatusPill.tsx:53) and ReportJobSummaryListSchema in web.
  - Test: Given jobs in each lifecycle state; when listing; then status is one of the documented enum values and each maps to a non-default StatusPill variant (contract test).
  - If wrong: Cosmetic/misleading: running or cancelled jobs shown as neutral, users re-submit jobs.

## visitor-service (5)

- [ ] **GAP-VISITOR-ADMIN-02** (high, unverified-service-absent) `['POST /api/proxy/v1/visitor/config (client.ts setConfig)', 'GET /api/v1/visitor/config/:namespace']`
  - Q: Does POST /v1/visitor/config require an admin role, honour expectedVersion (409 on stale) and emit an audit event with old/new value?
  - Verify: Open visitor-service config-registry route and guard; POST as guard/host token and admin token.
  - Test: Given host-role token, when POST /v1/visitor/config, then 403; admin write emits config.changed audit with before/after and stale expectedVersion returns 409.
  - If wrong: Any tenant user can change visitor approval/security policy without trace.
- [ ] **GAP-VISITOR-GUARD-01** (high, unverified-service-absent) `['GET /api/v1/visitor/evacuation/roster?locationId= (loaders.ts:138)']`
  - Q: Is the emergency roster fail-closed IP-allowlisted by design, and does a normal (non-break-glass) roster/inside-now endpoint exist for guards?
  - Verify: Open visitor-service evacuation route and IP allowlist middleware; list routes for a non-emergency inside-now query (e.g. check-ins?status=inside); curl roster from BFF IP.
  - Test: Given request from non-allowlisted IP with guard role, when GET evacuation/roster, then 403 and audit; a separate guard roster endpoint returns current occupants.
  - If wrong: Guard console core panel is permanently broken, or the break-glass roster gets opened to ordinary traffic.
- [ ] **GAP-VISITOR-HOME-02** (high, unverified-service-absent) `['POST /v1/visitor/config', 'POST /v1/visitor/check-ins', 'POST /v1/visitor/visit-requests/:id/approve']`
  - Q: Does visitor-service enforce per-endpoint roles (admin, guard, host) rather than trusting the web tiles?
  - Verify: Open visitor-service route guards; call each mutation with a token lacking the role.
  - Test: Given employee token without visitor roles, when POST config/check-ins/approve, then 403 for each.
  - If wrong: Privilege escalation across visitor functions.
- [ ] **GAP-VISITOR-HOST-01** (high, unverified-service-absent) `['GET /api/v1/visitor/visit-requests?status=pending_approval (loaders.ts:106)', 'POST /api/proxy/v1/visitor/visit-requests/:id/approve|reject (client.ts:76-80)']`
  - Q: Does the list endpoint scope pending_approval to the calling host (or accept hostEmployeeId), and does approve/reject verify caller is the request's host or a delegate/admin?
  - Verify: Open visitor-service visit-requests list and approve handlers; as host A, list pending and approve a request whose host is B.
  - Test: Given request raised for host B, when host A POSTs approve, then 403 and it stays pending_approval; host A's list excludes it.
  - If wrong: Any user can approve visitors for others: unauthorised premises access.
- [ ] **GAP-VISITOR-GUARD-06** (medium, unverified-service-absent) `['POST /api/proxy/v1/visitor/check-ins', 'POST /api/proxy/v1/visitor/check-outs (client.ts:59,63)']`
  - Q: Do check-in and check-out emit an audit event (actor, passId, gateId, timestamp), reject duplicates idempotently, and require guard role?
  - Verify: Open visitor-service check-ins/check-outs routes; call twice with same passId; check audit emission and role guard.
  - Test: Given a pass already checked in, when check-in is POSTed again, then 409 (or same result idempotently) with one audit event; check-out for a non-checked-in pass gives 409; non-guard gets 403.
  - If wrong: Wrong occupancy roster and no audit trail for physical access.

## unknown (4)

- [ ] **GAP-DOMAINS-NEW-01** (high, defect) `['POST /api/v1/domains']`
  - Q: 
  - Verify: 
  - Test: 
  - If wrong: 
- [ ] **GAP-PROCUREMENT-DASHBOARD-02** (medium, partly) `['GET /api/v1/procurement/dashboard']`
  - Q: Web-only: counters are plain StatCards and the API returns no value/aging.
  - Verify: Read dashboard/page.tsx:42-45.
  - Test: Given dashboard data, when rendered, then Pending Indents links to /procurement/indents?status=pending.
  - If wrong: Low usability: users cannot act from counters.
- [ ] **GAP-DASHBOARD-HOME-06** (low, partly) `[]`
  - Q: Do /careers and /docs/CivitasOne-User-Manual.pdf resolve?
  - Verify: ls apps/web/src/app/careers; ls apps/web/public/docs (public dir absent in snapshot).
  - Test: Playwright: GET /careers returns 200; HEAD /docs/CivitasOne-User-Manual.pdf returns 200 application/pdf.
  - If wrong: Broken marketing links.
- [ ] **GAP-PROCUREMENT-DASHBOARD-03** (low, defect) `['GET /api/v1/procurement/dashboard']`
  - Q: Web copy says real-time but loader revalidates every 60 s.
  - Verify: Read loaders.ts:2399-2405 and dashboard/page.tsx:30.
  - Test: Given the header, when rendered, then no 'Real-time' text and an 'Updated at' time is shown.
  - If wrong: Minor misleading copy.

## estab-service (4)

- [ ] **GAP-ESTAB-DASHBOARD-05** (low, partly) `['GET /api/v1/estab/dashboard']`
  - Q: 
  - Verify: Open estab/dashboard/page.tsx:51,96-102.
  - Test: Render test: dashboard with vehiclesInUse=3 shows 3 or the field is dropped.
  - If wrong: Cosmetic.
- [ ] **GAP-ESTAB-APPROVAL-MATRIX-02** (high, unverified-service-absent) `['GET /v1/estab/approval-rules', 'POST /v1/estab/approval-rules', 'PATCH /v1/estab/approval-rules/:id']`
  - Q: Do POST and PATCH approval-rules require an admin role (not any authenticated user) and emit audit events?
  - Verify: Open the approval-rules routes in estab-service; check requireRole on POST/PATCH. curl POST as an ordinary clerk expecting 403.
  - Test: Given role=clerk when POST approval-rules then 403; given estab_admin then 201 with audit event; PATCH toggle likewise.
  - If wrong: Anyone can rewrite who signs sanctions, payments and disciplinary actions.
- [ ] **GAP-ESTAB-HANDOVER-02** (high, unverified-service-absent) `['GET /v1/estab/operators', 'GET /v1/estab/handovers', 'POST /v1/estab/handovers']`
  - Q: Does POST handovers restrict bulk custody transfer to a supervisor/admin role and limit source desk to the caller's authority, with audit?
  - Verify: Open the handovers route in estab-service; check requireRole and source-desk ownership check. curl POST as a clerk moving another desk's files, expect 403.
  - Test: Given clerk C not owning desk D when POST handover from D then 403; given admin then 201, all files' custody updated and an audit event per batch.
  - If wrong: Any user can seize custody of another officer's files.
- [ ] **GAP-ESTAB-QUARTERS-03** (medium, unverified-service-absent) `['POST /v1/estab/quarters', 'GET /v1/estab/quarters']`
  - Q: Does POST quarters require an estate-officer role and does the following GET list include the new row immediately (no async projection)?
  - Verify: Open quarters create handler in estab-service; check requireRole and that GET reads the same table. POST then GET immediately and expect the new row.
  - Test: Given estate_officer POST quarter then 201 and GET returns it in the same second; given clerk then 403.
  - If wrong: Unauthorised inventory edits or user believes create failed.

## journey-service (4)

- [ ] **GAP-JOURNEYS-ACTIVE-03** (low, unverified-service-absent) `['GET /api/v1/journeys/executions']`
  - Q: GET /v1/journeys/executions must require a journeys role, tenant-scope, accept limit/cursor with a server default cap, and return {id,name,status,updatedAt} per row.
  - Verify: In journey-service open the handler for /api/v1/journeys/executions; curl it with a journeys role (expect 200 {data,pagination}), without role (403), with limit=1 (expect hasMore) and with 2000 seeded rows without limit (expect capped page).
  - Test: Given 1,000 rows, when GET /api/v1/journeys/executions with no limit then response is capped at the default page size with hasMore=true; other-tenant token sees 0 of these rows.
  - If wrong: Unbounded lists slow the page; wrong role/tenant exposure of workflow data.
- [ ] **GAP-JOURNEYS-ANALYTICS-03** (low, unverified-service-absent) `['GET /api/v1/journeys/executions']`
  - Q: GET /v1/journeys/executions must paginate or aggregate server-side, since the analytics page derives metrics from the same unbounded list as Active.
  - Verify: In journey-service open the handler for /api/v1/journeys/executions; curl it with a journeys role (expect 200 {data,pagination}), without role (403), with limit=1 (expect hasMore) and with 2000 seeded rows without limit (expect capped page).
  - Test: Given 1,000 rows, when GET /api/v1/journeys/executions with no limit then response is capped at the default page size with hasMore=true; other-tenant token sees 0 of these rows.
  - If wrong: Unbounded lists slow the page; wrong role/tenant exposure of workflow data.
- [ ] **GAP-JOURNEYS-BUILDER-03** (low, unverified-service-absent) `['GET /api/v1/journeys']`
  - Q: GET /v1/journeys must require a journeys role, tenant-scope, accept limit/cursor, and return definition summaries with id/name/status.
  - Verify: In journey-service open the handler for /api/v1/journeys; curl it with a journeys role (expect 200 {data,pagination}), without role (403), with limit=1 (expect hasMore) and with 2000 seeded rows without limit (expect capped page).
  - Test: Given 1,000 rows, when GET /api/v1/journeys with no limit then response is capped at the default page size with hasMore=true; other-tenant token sees 0 of these rows.
  - If wrong: Unbounded lists slow the page; wrong role/tenant exposure of workflow data.
- [ ] **GAP-JOURNEYS-TEMPLATES-03** (low, unverified-service-absent) `['GET /api/v1/journeys/triggers']`
  - Q: GET /v1/journeys/triggers (loaded as 'templates') must return template/trigger definitions with id/name/description and paginate; confirm triggers are the intended data for a Templates page.
  - Verify: In journey-service open the handler for /api/v1/journeys/triggers; curl it with a journeys role (expect 200 {data,pagination}), without role (403), with limit=1 (expect hasMore) and with 2000 seeded rows without limit (expect capped page).
  - Test: Given 1,000 rows, when GET /api/v1/journeys/triggers with no limit then response is capped at the default page size with hasMore=true; other-tenant token sees 0 of these rows.
  - If wrong: Unbounded lists slow the page; wrong role/tenant exposure of workflow data.

## recommendation-service (4)

- [ ] **GAP-RECOMMENDATIONS-FEEDBACK-04** (low, unverified-service-absent) `['GET /api/v1/recommendations/feedback']`
  - Q: Is the endpoint authenticated, role-limited, paginated (limit/cursor) and does it return the shape the loader expects?
  - Verify: Open the route in recommendation-service; curl /api/v1/recommendations/feedback without a token expecting 401, with a valid token expecting 200 and the documented fields, and with limit=1 expecting paging metadata.
  - Test: Given no token, when GET /api/v1/recommendations/feedback, then 401; given a token, then 200 with array items matching the schema.
  - If wrong: Unauthenticated or unbounded data exposure.
- [ ] **GAP-RECOMMENDATIONS-HEALTH-04** (low, unverified-service-absent) `['GET /api/v1/recommendations/health/at-risk']`
  - Q: Is the endpoint authenticated, role-limited, paginated (limit/cursor) and does it return the shape the loader expects?
  - Verify: Open the route in recommendation-service; curl /api/v1/recommendations/health/at-risk without a token expecting 401, with a valid token expecting 200 and the documented fields, and with limit=1 expecting paging metadata.
  - Test: Given no token, when GET /api/v1/recommendations/health/at-risk, then 401; given a token, then 200 with array items matching the schema.
  - If wrong: Unauthenticated or unbounded data exposure.
- [ ] **GAP-RECOMMENDATIONS-MATRIX-04** (low, unverified-service-absent) `['GET /api/v1/recommendations/matrix']`
  - Q: Is the endpoint authenticated, role-limited, paginated (limit/cursor) and does it return the shape the loader expects?
  - Verify: Open the route in recommendation-service; curl /api/v1/recommendations/matrix without a token expecting 401, with a valid token expecting 200 and the documented fields, and with limit=1 expecting paging metadata.
  - Test: Given no token, when GET /api/v1/recommendations/matrix, then 401; given a token, then 200 with array items matching the schema.
  - If wrong: Unauthenticated or unbounded data exposure.
- [ ] **GAP-RECOMMENDATIONS-NBA-04** (low, unverified-service-absent) `['GET /api/v1/recommendations/predictive']`
  - Q: Is the endpoint authenticated, role-limited, paginated (limit/cursor) and does it return the shape the loader expects?
  - Verify: Open the route in recommendation-service; curl /api/v1/recommendations/predictive without a token expecting 401, with a valid token expecting 200 and the documented fields, and with limit=1 expecting paging metadata.
  - Test: Given no token, when GET /api/v1/recommendations/predictive, then 401; given a token, then 200 with array items matching the schema.
  - If wrong: Unauthenticated or unbounded data exposure.

## field-service (3)

- [ ] **GAP-FIELD-ROUTES-02** (medium, unverified-service-absent) `['GET /api/v1/field/routes']`
  - Q: Does GET /v1/field/routes return stops (ordered), distance and assigned agent per route?
  - Verify: Open the routes handler in field-service and inspect the response schema; curl and inspect a route with stops.
  - Test: Given a route with 3 stops when GET routes then each item includes stops[] ordered, agentId and distanceKm.
  - If wrong: Hub claims AI-optimised routes but page shows only labels.
- [ ] **GAP-FIELD-SYNC-03** (medium, unverified-service-absent) `['GET /api/v1/field/sync/pull?since=']`
  - Q: Does sync/pull return a typed row with an explicit conflict status/flag and is there an endpoint to resolve conflicts?
  - Verify: Open the sync pull handler in field-service; inspect the row schema and any conflict/resolve route.
  - Test: Given two offline edits of one record when pulled then the row has status=conflict and a resolve endpoint accepts a chosen version.
  - If wrong: Silent data conflicts in field records.
- [ ] **GAP-FIELD-HOME-04** (low, unverified-service-absent) `['GET /api/v1/field/tasks', 'GET /api/v1/field/routes', 'GET /api/v1/field/visits']`
  - Q: Is the field module entitled per edition (Govt/PSU/Small Office) so tiles for unavailable features return 403/404 rather than empty?
  - Verify: Check edition entitlement config in field-service/policy-service for each endpoint.
  - Test: Given a Small Office tenant without field entitlement when GET /v1/field/routes then 403 with entitlement error code.
  - If wrong: Tiles shown for features the edition does not own.

## admin-service (or a future bulk-scan/jobs service) (2)

- [ ] **GAP-ADMIN-BULK-SCAN-02** (high, unverified-service-absent) `none registered`
  - Q: Is any bulk-scan route or job/registry service planned or registered in admin-service or elsewhere?
  - Verify: Search all service repos/gateway catalogue for 'bulk-scan'; check gateway-service /api/v1/gateway/catalogue for a matching prefix.
  - Test: Given the gateway catalogue, when listing routes, then a bulk-scan prefix is present (or the web route is removed).
  - If wrong: Dead nav item advertises a feature that does not exist.
- [ ] **GAP-ADMIN-DISCOVERY-02** (high, unverified-service-absent) `none registered`
  - Q: Is any discovery route or job/registry service planned or registered in admin-service or elsewhere?
  - Verify: Search all service repos/gateway catalogue for 'discovery'; check /api/v1/gateway/catalogue.
  - Test: Given the gateway catalogue, when listing routes, then a discovery prefix is present (or the web route is removed).
  - If wrong: Dead nav item advertises a feature that does not exist.

## ml-service (2)

- [ ] **GAP-ANALYTICS-ML-INSIGHTS-ANOMALIES-06** (medium, unverified-service-absent) `GET /api/v1/ml/evaluations?domain=anomalies&window=30d`
  - Q: Does the evaluation response define fallbackRate as rule-based fallback share and provide a separate falsePositiveRate, or is fallbackRate mislabelled?
  - Verify: Open ml-service evaluations schema/handler; curl domain=anomalies and inspect fields and their computation.
  - Test: Given 100 predictions of which 10 used fallback and 5 were confirmed false positives, when GET evaluations, then fallbackRate=0.10 and falsePositiveRate=0.05 are separate fields.
  - If wrong: Model quality misreported to decision makers.
- [ ] **GAP-ANALYTICS-ML-INSIGHTS-LEADS-05** (medium, unverified-service-absent) `GET /api/v1/ml/evaluations?domain=leads (row links to /api/v1/crm/contacts/{id})`
  - Q: Does the ml evaluations/leads response expose per-person data only to callers holding a CRM read role, and does crm-service still enforce its own role on /crm/contacts/{id}?
  - Verify: Open ml-service leads handler for role guard and PII fields; curl as analytics-only user and confirm no contact identifiers; curl crm contact as same user expecting 403.
  - Test: Given analytics-only role, when GET leads evaluation, then no personal identifiers; when GET crm contact, then 403.
  - If wrong: DPDP purpose-limitation breach: personal data and automated scores visible without CRM entitlement.

## document-service (2)

- [ ] **GAP-DOCUMENTS-INBOX-02** (high, unverified-service-absent) `['GET /v1/documents/inbox', 'GET /v1/documents/inbox/summary']`
  - Q: Does /inbox return the full user-scoped list (or page metadata with total) and does /inbox/summary count the same scope as the Library page?
  - Verify: Open the inbox and summary handlers in document-service; compare filters and pagination; seed 120 items and check list length vs summary.inboxCount.
  - Test: Given 120 inbox items for user U when GET inbox is called then either all are returned or response includes total, and summary.inboxCount == 120.
  - If wrong: KPI tiles disagree with the Library and undercount pending dak.
- [ ] **GAP-DOCUMENTS-NEW-03** (medium, unverified-service-absent) `['POST /api/v1/documents/files']`
  - Q: Does the create handler validate fileName length/extension with zod, require auth and emit an audit event?
  - Verify: Open the files POST route in document-service; POST a 300-char name and a .exe name, expecting 422; check audit emit.
  - Test: Given fileName of 300 chars or disallowed extension when POSTed then 422 with fieldErrors; valid create emits one audit event.
  - If wrong: Bad file names and unaudited document creation.

## loyalty-service (2)

- [ ] **GAP-LOYALTY-HOME-03** (medium, unverified-service-absent) `['GET /api/v1/loyalty/programs', '/enrolments', '/redemptions']`
  - Q: Which roles may read each loyalty endpoint and are member records scoped/audited?
  - Verify: Open loyalty-service route guards; curl each endpoint with employee vs loyalty admin JWT.
  - Test: Given employee token, when GET enrolments, then 403 or own-record only.
  - If wrong: Member PII and balances visible to all users.
- [ ] **GAP-LOYALTY-PROGRAMS-03** (low, unverified-service-absent) `['GET /api/v1/loyalty/programs']`
  - Q: What is the exact programme response shape and is name always present?
  - Verify: Open loyalty-service programs DTO/schema; curl GET and inspect keys; check name is NOT NULL.
  - Test: Given programme created via API, when GET list, then each item has non-empty name.
  - If wrong: Raw UUIDs shown as names.

## metadata-service (2)

- [ ] **GAP-METADATA-HOME-01** (high, unverified-service-absent) `['all /api/v1/metadata/*']`
  - Q: Do metadata write routes require a schema-admin role, and are entity/field/rule changes audited and versioned?
  - Verify: Open metadata-service route guards; curl POST entity with employee JWT expecting 403.
  - Test: Given non-admin token, when POST/PUT metadata entity, then 403; admin change writes audit.
  - If wrong: Any user can alter tenant schema.
- [ ] **GAP-METADATA-ENTITIES-03** (medium, unverified-service-absent) `['GET /api/v1/metadata/entities']`
  - Q: What is the entity list response envelope and fields (key, label, description, type, fieldsCount)?
  - Verify: Open metadata-service entities handler/DTO; curl GET and inspect envelope and keys.
  - Test: When GET entities, then items[] each with entityKey, label; envelope matches loader (array/data/items).
  - If wrong: Empty or mislabelled entity table.

## admin-service / identity-service (2)

- [ ] **GAP-PLATFORM-ADMIN-HOME-01** (high, unverified-service-absent) `['GET/PUT /api/v1/admin/* (roles, settings, users)']`
  - Q: Every /v1/admin/* endpoint must enforce platform_admin/tenant_admin server-side so that a user reaching /platform-admin sees only 403s.
  - Verify: In admin-service list all route files and check each has a role preHandler; curl GET /v1/admin/roles and /v1/admin/users as employee expecting 403.
  - Test: Given employee JWT, when GET /v1/admin/roles, then 403.
  - If wrong: Broken access control to role/user administration.
- [ ] **GAP-PLATFORM-ADMIN-ROLES-01** (high, unverified-service-absent) `['GET /api/v1/admin/roles/:id', 'PATCH /api/v1/admin/roles/:id/permissions']`
  - Q: PATCH role permissions must enforce SoD server-side (reject any permissionKeys set containing both submit and approve for the same resource) and audit the diff.
  - Verify: Open admin-service role-permissions handler; look for an SoD conflict table check. curl PATCH with a set holding X.submit + X.approve expecting 409/422.
  - Test: Given a role, when PATCH permissionKeys including both submit and approve, then 422 SOD_CONFLICT and role unchanged.
  - If wrong: A role can both raise and approve transactions, defeating maker-checker.

## identity-service (and admin-service) (2)

- [ ] **GAP-TENANT-ADMIN-API-KEYS-03** (medium, unverified-service-absent) `['GET /api/v1/admin/api-keys', 'POST/DELETE /api/proxy/identity/api-keys']`
  - Q: Do the read (admin) and write (identity) paths operate on the same api-keys store so a created key appears in the list?
  - Verify: Check gateway routing for /api/v1/admin/api-keys vs identity/api-keys; create a key via POST then list; open both services' handlers.
  - Test: Given POST api-key; when GET /api/v1/admin/api-keys; then the new key (prefix only, no secret) is listed; revoke removes it.
  - If wrong: Created/revoked keys not reflected; stale keys stay live.
- [ ] **GAP-TENANT-ADMIN-BREAKGLASS-06** (low, unverified-service-absent) `['GET /api/v1/admin/breakglass', 'POST /api/proxy/identity/break-glass/{id}/close']`
  - Q: What does status auto_expired mean, when is it set (TTL job), and is it distinct from closed?
  - Verify: Open break-glass session model and expiry job in identity-service; create a session with short TTL and GET after expiry.
  - Test: Given session with 1 minute TTL; when TTL elapses; then status===auto_expired with expiredAt and audit event; manual close yields closed.
  - If wrong: Misleading incident reporting on privileged access.

## gateway-service (1)

- [ ] **GAP-ADMIN-GATEWAY-ROUTES-01** (high, unverified-service-absent) `GET /api/v1/gateway/catalogue`
  - Q: Does gateway-service return 403 on GET /api/v1/gateway/catalogue for any caller lacking super_admin/platform_admin (and scope tenant data to the caller's tenant), regardless of the web page having no gate?
  - Verify: In gateway-service repo open the route file registering GET /api/v1/gateway/catalogue and confirm a preHandler/requireRole guard; then curl it with a JWT of a plain tenant user (e.g. employee) and expect 403, with a super_admin JWT expect 200.
  - Test: Given a JWT with role=employee, when GET/PATCH GET /api/v1/gateway/catalogue, then 403 and no body data; given super_admin, then 200.
  - If wrong: Any signed-in user reads or changes platform-operator data (privilege escalation / cross-tenant exposure).

## ai-agent-service (1)

- [ ] **GAP-AI-GOVERNANCE-02** (high, unverified-service-absent) `POST /api/v1/ai/agents/{id}/pause and /resume`
  - Q: Does pause/resume require an AI-governance role, emit an audit event with actor and reason, and is it idempotent?
  - Verify: Open the ai-agent-service agents route; curl pause as unprivileged user expecting 403, twice as privileged expecting 200 both times; check audit store.
  - Test: Given governance role, when POST pause on a live agent, then 200, status=paused and audit event {actor, agentId}; repeat pause returns 200 without duplicate side effects.
  - If wrong: Live citizen-facing agent halted without trace or by an unauthorised user.

## catalogue-service (1)

- [ ] **GAP-CATALOGUE-HOME-02** (medium, unverified-service-absent) `['GET /api/v1/catalogue/products', '/products/tree', '/rates', '/bundles']`
  - Q: Which roles may create/edit products, rates and bundles, and is there any write API the web should expose?
  - Verify: Open catalogue-service routes; list POST/PUT/DELETE handlers and role guards; confirm reads open to all tenant users.
  - Test: Given role viewer; when POST /catalogue/products; then 403; catalogue_admin gets 201 and audit row.
  - If wrong: Unowned catalogue maintenance or unrestricted edits to prices.

## web (no backend) (1)

- [ ] **GAP-CATALOGUE-HOME-05** (low, defect) `['GET /help/catalogue']`
  - Q: Does a help article with slug 'catalogue' exist?
  - Verify: Checked apps/web/src/lib/helpContent.ts: HELP_MODULES has 11 entries, none with slug catalogue; app/(app)/help/[module]/page.tsx calls notFound() for unknown slugs.
  - Test: Given PageHeader help='catalogue'; when link followed; then /help/catalogue returns 200 (test iterates all help props against HELP_MODULES).
  - If wrong: Dead help link (404) on the catalogue hub.

## (none) (1)

- [ ] **GAP-CONTACT-HOME-06** (low, unverified-service-absent) `['(none) mailto:hello@ / security@']`
  - Q: Are hello@ and security@ mailboxes provisioned with routing/ticketing and a monitored SLA?
  - Verify: Check mail/DNS config and ticketing rules with ops; send a test mail to each address.
  - Test: Given a test mail to security@, when sent, then a ticket or on-call alert is created within SLA.
  - If wrong: Vulnerability reports lost; medium.

## court-service (1)

- [ ] **GAP-COURT-HOME-04** (medium, unverified-service-absent) `['GET /api/v1/court/cases/analytics', 'GET /api/v1/court/cases/pendency', 'GET /api/v1/court/cases']`
  - Q: Who may read analytics/pendency and how are instituted, disposed and clearanceRatePct computed (period, null when zero)?
  - Verify: Open court analytics handler; compare with seeded data; call as low-role user.
  - Test: Given 10 instituted and 8 disposed, when GET analytics, then clearanceRatePct = 80 and null when instituted=0; unauthorised role gets 403.
  - If wrong: Wrong judicial statistics; medium.

## crm-service (web-only finding) (1)

- [ ] **GAP-CRM-HEALTH-ACCOUNTID-06** (low, defect) `['POST /api/proxy/v1/crm/service-requests (modal)']`
  - Q: Is FollowUpButton.tsx unreferenced and FollowUpModal a hand-rolled overlay instead of the shared dialog primitive?
  - Verify: grep importers
  - Test: 
  - If wrong: Dead code and inconsistent a11y/focus trap.

## citizen-service (catalogue) (1)

- [ ] **GAP-DESIGNER-DETAIL-REVIEW-01** (high, unverified-service-absent) `['POST /v1/citizen/catalogue/services/:id/publish', 'POST /v1/citizen/catalogue/services/:id/reject', 'POST /v1/citizen/catalogue/services/:id/submit']`
  - Q: Does publish/reject require a Department Head/approver role and reject when caller equals the submitter (maker-checker)?
  - Verify: Open publish handler in citizen-service catalogue module; check requireRole list and submittedBy != actor. curl publish as a plain office user and as the submitter, expect 403 both.
  - Test: Given a submitted definition by user A, when A or a non-approver POSTs publish then 403; when a dept_head B POSTs then 200 and audit event emitted.
  - If wrong: Any office user can publish citizen services; unauthorised service changes go live.

## citizen-service, finance-service (1)

- [ ] **GAP-DESIGNER-DETAIL-TEST-01** (high, unverified-service-absent) `['POST /v1/citizen/catalogue/services/:id/sandbox-test/run', 'GET .../sandbox-test/latest']`
  - Q: Does sandbox-test/run create payment and GL journal in an isolated sandbox (flagged, rolled back or separate ledger) never touching real balances or reports?
  - Verify: Open the sandbox-test handler in citizen-service and the finance call it makes; run the test and query journals/GL totals before and after, expecting no change to production trial balance.
  - Test: Given a run of steps 5-6 when finished then no posted journal or payment exists in the live ledger (or rows are sandbox=true and excluded from reports).
  - If wrong: Test runs pollute the real GL and payment records; audit and financial misstatement.

## domain-service (1)

- [ ] **GAP-DOMAINS-NEW-05** (medium, unverified-service-absent) `['POST /api/v1/domains']`
  - Q: Does the create handler require an authorised role, validate email/phone with zod, and emit an audit event including PII-safe payload?
  - Verify: Open the domains POST handler in domain-service; call as a role with no domain-admin right expecting 403; check audit emit and that contact fields are not logged in clear.
  - Test: Given a non-admin user when POST /v1/domains then 403; given admin then 201 and one audit event without raw email/phone.
  - If wrong: DPDP exposure and unauthorised domain registration.

## assets-service (1)

- [ ] **GAP-FLEET-HOME-04** (low, unverified-service-absent) `['GET /api/v1/assets/fleet/dashboard']`
  - Q: Does scheduledMaintenance count only vehicles with maintenance due within 7 days?
  - Verify: Open the fleet dashboard handler in assets-service; read the scheduledMaintenance query window.
  - Test: Given 2 vehicles due in 3 days and 1 in 30 days when dashboard fetched then scheduledMaintenance=2.
  - If wrong: Label states 7d but count may include all future maintenance.

## grants-service (1)

- [ ] **GAP-GRANTS-DISBURSEMENTS-DETAIL-02** (high, unverified-service-absent) `['GET /api/v1/grants/releases', 'POST /api/proxy/v1/grants/disbursements/:id/submit-approval']`
  - Q: Is GrantRelease.amount stored in rupees or paise (minor units per CLAUDE.md rule 11)?
  - Verify: Open the releases schema/handler in grants-service and check the column type and unit; create a release of Rs 1,000 and read back amount.
  - Test: Given release of Rs 1000 when GET releases then amount=100000 (paise) if minor; contract test pins the unit.
  - If wrong: 100x misstatement of grant amounts and wrong approval-chain routing by amount.

## helpdesk-service (1)

- [ ] **GAP-HELPDESK-CATALOGUE-BREACHES-03** (medium, unverified-service-absent) `['GET /api/v1/helpdesk/catalogue/requests/breaches']`
  - Q: Does the breaches endpoint restrict tenant-wide requestedBy/stage data to supervisor/admin roles?
  - Verify: Open the breaches route in helpdesk-service; check requireRole. curl as a plain user, expect 403.
  - Test: Given role=employee when GET breaches then 403; given helpdesk_admin then 200.
  - If wrong: Employee names and request stages exposed to all users.

## apps/web (1)

- [ ] **GAP-INSTALL-CONSOLE-02** (medium, defect) `['GET /help/install (apps/web help route)']`
  - Q: The help slug 'install' passed to PageHeader must resolve to a help module.
  - Verify: Open apps/web/src/lib/helpContent.ts; HELP_MODULES slugs are finance, procurement, hr, payroll, estab, grants, projects, citizen, tenant-admin (lines 57-324) - no 'install'. Load /help/install expecting 404.
  - Test: Given ModuleHub help=install, when /help/install is requested, then 200 with title (currently notFound()).
  - If wrong: Help link on the install console 404s; installers get no guidance.

## apps/web (install-service shape unverified) (1)

- [ ] **GAP-INSTALL-HOME-01** (high, defect) `['GET /api/v1/install/steps']`
  - Q: See evidence.
  - Verify: Verified by reading source; see evidence.
  - Test: Given sample steps payload, mapper returns title, stepNo, isRequired populated.
  - If wrong: Installer wizard shows blank titles and wrong progress.

## web gateway (next.config redirects) (1)

- [ ] **GAP-INVENTORY-DETAIL-02** (high, unverified-service-absent) `['GET /stock/ledger/new?itemId=', 'redirect /stock/:path* -> /inventory/:path*']`
  - Q: next.config redirects must not swallow /stock/ledger/new (or an /inventory/ledger/new page must exist), so the + Stock Entry link reaches the entry form with itemId prefilled.
  - Verify: Open apps/web/next.config.mjs (absent from snapshot) and check the /stock/:path* redirect; in a browser or curl -I /stock/ledger/new?itemId=X expect 200 not 308 to /inventory/ledger/new. Note src/app/(app)/stock/ledger/new exists but inventory has no ledger/new route (ls inventory).
  - Test: Given an authenticated session, when GET /stock/ledger/new?itemId=X then the New Stock Entry form renders with item X preselected (no 404).
  - If wrong: Primary stock action on the item page lands on not-found, users cannot record stock.

## service worker / sync layer (no backend service) (1)

- [ ] **GAP-OFFLINE-HOME-02** (high, unverified-service-absent) `['service worker fetch handler', 'POST queued mutations via lib/sync/requestQueue.ts']`
  - Q: Is a service worker registered that serves /offline and replays queued mutations idempotently on reconnect?
  - Verify: Grep repo for sw.js/registration; in Chrome DevTools go offline, submit a mutation, reconnect and confirm one replay.
  - Test: Given queued approval offline, when connection returns, then exactly one request with same idempotency key is sent and count shown.
  - If wrong: Queued approvals lost or duplicated.

## plugin-service (1)

- [ ] **GAP-PLUGINS-HOME-01** (high, unverified-service-absent) `['GET /api/v1/plugins/items', 'POST /api/v1/plugins/install', 'POST /api/v1/plugins/:id/:verb']`
  - Q: install/enable/disable must require tenant_admin/platform_admin and be audited; list may be broader.
  - Verify: Open plugin-service route files; check role guard on install and verb routes. curl POST install as employee expecting 403.
  - Test: Given employee JWT, when POST plugins/install, then 403.
  - If wrong: Any user can install or disable tenant-wide plugins.

## analytics-service (1)

- [ ] **GAP-TENANT-ADMIN-ACTIVATION-05** (low, unverified-service-absent) `['GET /api/v1/analytics/activation/funnel', 'GET /api/v1/analytics/activation/funnel/platform']`
  - Q: Do both funnel endpoints exist, is /platform restricted to platform admins, and are responses tenant-scoped?
  - Verify: Open analytics-service funnel routes; call /platform with a tenant admin token expecting 403; compare shape with web schema.
  - Test: Given tenant admin; when GET funnel/platform; then 403; GET funnel returns only own tenant stages.
  - If wrong: Cross-tenant metrics leak.

## install-service (1)

- [ ] **GAP-TENANT-ADMIN-INSTALL-05** (low, unverified-service-absent) `['GET /api/v1/install/steps (loaders.ts:4344)', 'GET /api/v1/install/stages (loaders.ts:748)']`
  - Q: Are install steps and installer stages the same resource at two granularities, and is step status consistent with the stage rollup?
  - Verify: Open install-service routes for steps and stages; compare schemas and derive step->stage mapping; curl both for one tenant.
  - Test: Given a tenant with 2 of 5 stages complete, when both endpoints are read, then steps completed count equals sum of steps of completed stages.
  - If wrong: Onboarding shows contradictory progress between pages.

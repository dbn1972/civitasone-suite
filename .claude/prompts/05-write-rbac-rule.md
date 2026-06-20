# Workflow Prompt — Write RBAC Rule

**Use when:** Adding a new permission to `policy-service`.

---

## Fill these placeholders

```
PERMISSION KEY: {{service}}.{{resource}}.{{action}}
  Examples: finance.journal.create, hrms.leave.approve, helpdesk.ticket.delete

PURPOSE (one sentence): {{who can do what to which resource}}
ISSUE: {{GitHub issue link}}

ALLOWED ROLES (built-in role names):
- {{role1}}
- {{role2}}

CONDITIONS (optional — applied after role check):
- TENANT_SCOPE: always — actor.tenantId must equal resource.tenantId (never overridable)
- OWNER_ONLY: actor.userId must equal resource.createdBy
- STATUS_CHECK: resource.status must be in [{{list}}]
- AMOUNT_CHECK: resource.amount <= actor.approval_limit
- ORG_UNIT_CHECK: resource.orgUnitId in actor.orgUnitMembership
- HOURS_CHECK: now within tenant business hours

DELEGATION:
- Can this permission be delegated? {{yes/no}}
- Delegation expiry: {{default 7 days}}
- Delegation requires audit comment: {{yes/no}}

OVERRIDE:
- Break-glass override allowed? {{yes/no — default no}}
- Override requires: support-mode session + dual approval + audit comment

CACHE:
- TTL: 60 seconds (default — match Vol 5)
- Invalidation triggers: role change, user suspension, tenant suspension, policy update

TESTS (vitest):
- Allow: role + all conditions met
- Deny: missing role
- Deny: role present but condition fails (one test per condition)
- Allow via delegation: delegation valid + within expiry
- Deny via delegation: delegation expired
- Allow via break-glass (if applicable): support-mode + dual approval recorded
- Cache hit returns same decision
- Cache invalidates on role change
- All decisions emit a policy.decision audit event with allow/deny + reason
```

---

## Output instructions for Claude

Produce these files:

1. `services/policy-service/src/permissions/{{service}}.{{resource}}.{{action}}.ts` — permission definition
2. `services/policy-service/src/permissions/{{service}}.{{resource}}.{{action}}.test.ts` — vitest
3. Update `services/policy-service/src/permissions/index.ts` to register the permission
4. Create migration via `03-write-migration.md` to seed the permission into `policy_permissions` table
5. Update `apps/web` route guards if a new web route uses this permission

After writing files, run:
```
pnpm --filter @civitasone/policy-service typecheck
pnpm --filter @civitasone/policy-service test permissions
pnpm --filter @civitasone/policy-service db:migrate:dry
```

---

## Anti-patterns

- Hardcoding permission checks in business services → always go through policy-service
- Skipping tenant scope condition → cross-tenant data leak
- Combining unrelated permissions in one key → split them
- No audit event on policy decision → invisible authorization bug
- Allowing override without dual approval → single-actor bypass

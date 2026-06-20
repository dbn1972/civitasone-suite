# Skill — RBAC Policy Language

**When to load:** Building anything that touches `policy-service` or wiring permissions in any other service.

---

## Permission key format

```
{service}.{resource}.{action}
```

Examples:
- `finance.journal.create`
- `finance.journal.post`
- `finance.journal.reverse`
- `procurement.po.approve`
- `hrms.leave.approve`
- `helpdesk.ticket.delete`
- `tenant.user.suspend`

Rules:
- All lowercase, dot-separated
- Three segments exactly
- Verbs: `create`, `read`, `update`, `delete`, `approve`, `reject`, `submit`, `post`, `reverse`, `export`, `import`, `assign`, `reassign`, `suspend`, `restore`
- No wildcards in keys (no `finance.*.create`)

## Role model

### Built-in roles (cannot be deleted, can be renamed per tenant)
- `platform.super_admin` — only set during install, never assigned at runtime through UI
- `tenant.admin` — full tenant admin within one tenant
- `tenant.support_agent` — read-only with break-glass capability
- Module-specific roles defined per module (e.g. `finance.manager`, `finance.accountant`, `hrms.manager`, `hrms.employee`)

### Custom roles (per tenant)
- Created by `tenant.admin`
- Composed from permission keys
- Cannot exceed any quota set in tenant plan

## Conditions (evaluated after role check)

All conditions are AND-ed unless explicitly OR'd. The DSL:

```typescript
type Condition =
  | { type: 'tenant_scope' }                       // always applied
  | { type: 'owner_only' }
  | { type: 'status_in'; statuses: string[] }
  | { type: 'amount_max'; field: string; against: 'actor.approval_limit' | 'literal'; value?: number }
  | { type: 'org_unit_member' }
  | { type: 'business_hours' }
  | { type: 'and'; of: Condition[] }
  | { type: 'or'; of: Condition[] };
```

## Evaluation API

```
POST /policy/evaluate
{
  permissionKey: "finance.journal.post",
  actor: { userId, tenantId, roles, orgUnits, approvalLimit },
  resource: { tenantId, createdBy, status, amount, orgUnitId },
  context: { correlationId, timestamp }
}

Response:
{
  decision: "allow" | "deny",
  reason: "role:finance.manager + status_in:[draft]",
  cacheable: true,
  ttlSeconds: 60
}
```

Every decision (allow + deny) emits an audit event: `policy.decision`.

## Delegation

- A user with permission X can delegate X to user Y for max 7 days (configurable per tenant)
- Delegation requires audit comment + tenant_admin notification
- Delegated permission marked in audit events: `actor.via_delegation_of=originalUserId`
- Delegation can be revoked at any time by either party or tenant_admin

## Break-glass / support mode

- A user with `tenant.support_agent` role can elevate to act-as-admin for a limited window
- Elevation requires: dual approval + audit comment + duration cap (max 4 hours)
- Every action in support mode tagged in audit with `support_mode=true` and the dual approvers
- SRE alert fires on every elevation

## Caching rules

- All decisions cached in Redis for 60s (default)
- Cache key: `policy:{tenantId}:{userId}:{permissionKey}:{resourceFingerprint}`
- Invalidation triggers:
  - User role change → drop all `policy:{tenantId}:{userId}:*`
  - Role permission change → drop all `policy:{tenantId}:*:{permissionKey}:*`
  - User suspension → drop all `policy:{tenantId}:{userId}:*`
  - Tenant suspension → drop all `policy:{tenantId}:*`

## Forbidden patterns

- Hardcoded permission checks in services (`if (user.role === 'admin')`) — always call policy-service
- Permission key with more or fewer than 3 segments
- Wildcard permission grants
- Skipping audit on policy decision
- Bypassing tenant_scope condition
- Allowing override without dual approval and audit

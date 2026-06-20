# Skill — Audit Event Specification

**When to load:** Any service writing data, every PR with a mutation, every PR touching `audit-service`.

---

## Why audit is mandatory (Vol 1/4.7, Vol 5)

CivitasOne serves Govt and PSU customers — audit trail is a product requirement, not optional. Every business-critical mutation produces an immutable record that survives the lifetime of the tenant and meets regulatory retention (typically 7 years).

## Event shape (must match `@civitasone/events`)

```typescript
{
  id: string;                  // UUID v7
  tenantId: string;            // never null
  actorId: string;             // user, service account, or "system"
  actorType: "user" | "service_account" | "system" | "support";
  service: string;             // emitting service name
  action: string;              // verb-form, e.g. "journal.posted"
  resourceType: string;        // e.g. "finance_journal_entry"
  resourceId: string;          // the row's UUID
  outcome: "success" | "failure";
  correlationId: string;       // request correlation
  metadata?: Record<string, unknown>;  // small structured data only — NO PII
  timestamp: string;           // UTC ISO 8601
  ipAddress?: string;          // hashed for storage
  userAgent?: string;          // truncated, parsed family only
  via_delegation_of?: string;  // if delegated
  support_mode?: boolean;      // if support-mode action
}
```

## When to emit

| Action class | Emit? | Notes |
|---|---|---|
| Authentication (login, logout, mfa, password reset) | ✅ | success + failure both |
| Authorization decisions | ✅ | every allow + deny |
| Create / update / delete | ✅ | one event per logical operation, not per DB row |
| Approve / reject / submit | ✅ | include comment in metadata |
| Permission / role change | ✅ | before-after diff in metadata |
| Tenant lifecycle change | ✅ | with reason |
| Bulk operations | ✅ | one event per item processed (rate-limit consumer if huge) |
| Reads of sensitive data | ✅ | only when data is classified sensitive (PII, payroll) |
| Routine reads | ❌ | excessive noise, use metrics instead |

## Immutability rules

- `audit_events` table is append-only at DB level (no UPDATE / DELETE grants)
- WORM (write-once-read-many) storage for export bundles
- Quarterly proof-of-completeness check: count of audit events vs count of mutations (sampled)

## Storage and retention

- Hot storage (Postgres in audit-service): last 12 months
- Cold storage (S3 / object storage): months 12–84 (year 7)
- Beyond 7 years: per tenant retention policy (Govt typically forever)
- Indexes: `(tenant_id, timestamp DESC)`, `(tenant_id, actor_id)`, `(tenant_id, resource_type, resource_id)`

## Export for regulators

- Endpoint: `POST /audit/exports` — async job, returns export id
- Filter by: date range, actor, resource, action class
- Format: JSONL + hash chain manifest + signed manifest (proves completeness)
- Delivery: signed S3 URL, retention 7 days

## What metadata MUST and MUST NOT contain

✅ MUST:
- Before-after snapshots of key fields when an update changes them
- Reason / comment when an action requires one (approve / reject / reverse / suspend)
- Identifiers of related resources (e.g. journal id when posting GL entries)

❌ MUST NOT:
- Passwords, secrets, tokens, API keys (even hashed)
- Raw PII like full email body, full document body, biometric data
- Personally identifying information of citizens beyond the resource ID
- Large blobs (> 4KB metadata) — use a separate object store and link by reference

## Forbidden patterns

- Emitting audit from a controller / route layer (emit from the service layer after commit)
- Emitting audit before commit (creates ghost events if commit fails)
- Suppressing failure events (failure auditing is more important than success)
- Including PII in metadata
- Editing or deleting an audit row
- Storing audit in the same DB as business data (`audit-service` has its own DB)

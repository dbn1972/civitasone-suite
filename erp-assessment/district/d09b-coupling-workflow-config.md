# L09 — Loose Coupling, Workflow Architecture, Failure/Resilience & Configurability
## District Governance Architecture Review Board

**Branch inspected:** `court-management-service`  
**Reviewer lane:** L09 — Microservices/Event-Driven + Workflow/eOffice + Testing/Assurance + Configurability  
**Prior board deliverables referenced:** `erp-assessment/02-architecture-discovery.md`, `08-tenant-isolation-report.md` (tenant-iso 7/10)

---

## TASK A — Loose-Coupling Assessment

### A.1 Property-by-property matrix

| Property | Status | Evidence | Gap / Required change |
|---|---|---|---|
| **API-first** | PRESENT | All 38 services expose REST under `/v1/<service>/…`. Routes discovered in every `services/*/src/modules/*/routes.ts`. | No schema-first (OpenAPI-generated) tooling — routes are hand-authored Fastify handlers with ad-hoc Zod validators. No consumer SDK generated from specs. |
| **Event-driven** | PRESENT | `packages/outbox/src/index.ts:enqueue()` + `startRelay()`. All state changes flow `route → queue.publish → consumer → outbox`. Topics declared in `services/*/src/topics.ts`. | Events carry `tenantId` only — **no `jurisdictionId`, `officeId`, or `orgUnitId` on the envelope** (see §A.3). Critical for federated routing. |
| **Domain-owned data** | PRESENT | DB-per-service enforced; CI grep for cross-prefix joins (CLAUDE.md §3). | Location-service's `JURISDICTION_LEVELS` enum is hardcoded TypeScript (`location-service/src/modules/jurisdiction/validators.ts:4`), not read from config. See Task D. |
| **No cross-service DB access** | PRESENT | One DB login per service; zero cross-database grants (CLAUDE.md §3). | [VERIFIED] |
| **Contract versioning** | PARTIAL | All routes are under `/v1/`. Event envelope carries `schemaVersion: "1.0"` (all observed in `packages/outbox/src/index.ts:73`). `packages/events/src/schema-registry.ts` implements per-type per-version Zod schema registry with backward-compat check. | Schema registry is **in-memory only** (`schema-registry.ts:27`: `const registry = new Map…`); not wired at publish/consume boundaries in any service; `registerSchema()` is called in tests but **zero calls found in production service code**. No v2 versions exist. No API versioning beyond `/v1/` prefix — no `Accept: application/vnd.civitas.v2+json`. Contract governance absent. |
| **Transactional outbox** | PRESENT (VERIFIED) | `packages/outbox/src/index.ts`: `enqueue()` inserts into `_outbox.messages` in same transaction; `startRelay()` publishes + marks `published_at`; per-row isolation on failure (`incrementOutboxRelayFailure + captureError`). All services import via `shared/outbox.ts` (re-export). | Relay interval hardcoded at 500 ms default — no env override documented for higher-latency district links. `publishedAt` is set after queue publish but within a separate non-transactional update — relay crash between publish and mark produces a duplicate, relied on idempotent consumer to dedupe. |
| **Idempotent consumers** | PRESENT (VERIFIED) | `markProcessed()` at `packages/outbox/src/index.ts:109`: atomic `INSERT…ON CONFLICT DO NOTHING RETURNING` — race-free. All transaction consumers call `markProcessed` before business logic (`workflow-service/src/modules/instances/consumer.ts:29`). | Not consistently adopted: `analytics-service/src/modules/*/consumer.ts` re-throws on error (`H11 FIX: rethrow so message redelivers/DLQs`) without calling `markProcessed` — duplicate delivery would double-count facts. |
| **Dead-letter queues** | PARTIAL | `workflow-service`: DB-backed DLQ in `workflow-service/src/modules/dlq/` — `dlqWrap()` retries N times then dead-letters to `workflow.dead_letters` table; configurable via `WORKFLOW_DLQ_MAX_ATTEMPTS`. `court-service`: per-worker DLQ via `DLQ_TOPIC = court.dlq` at `court-service/src/worker.ts:70`. Other services (`analytics-service`, `admin-service`): re-throw on error — rely on broker redelivery with **no permanent dead-letter capture** (`// H11 FIX: rethrow so message redelivers/DLQs`). | No broker-level SQS DLQ configured (infra not inspected but `queue-service` uses in-memory + SQS; no DLQ `RedrivePolicy` found). Only workflow + court services have application-level DLQ persistence. 34+ other consumers lack it. |
| **Retry + backoff** | PARTIAL | `billing-service/src/modules/gateways/retry.ts`: exponential backoff with configurable intervals for payment gateways. `identity-service/src/shared/kc-reconcile.ts:90`: capped exponential backoff (`min(60_000 * 2^attempts, 3_600_000)`). `court-service/src/worker.ts:67`: `1s, 2s, 4s` backoff. | No shared retry utility — 5+ bespoke implementations. No jitter (risk of thundering herd from a district site restart). Consumer-level retry is basic re-throw; no typed `NonRetryableError` classification outside `court-service`. |
| **Circuit breakers** | PARTIAL | `@civitasone/circuit-breaker` package (`packages/circuit-breaker/src/index.ts`): consecutive-failure state machine (closed→open→half-open). Used in: `gateway-service` upstream proxy, `billing-service` (4 breakers), `hrms-service` payroll client, `helpdesk-service` ML, `finance-service` PFMS/TRACES, `citizen-service` AI, `legal-service` eCourts, `location-service` routing, `knowledge-service` AI. | **Intra-district service calls have no circuit breakers.** `helpdesk-service/src/modules/cmdb/asset-client.ts`: calls `asset-service` with a plain `AbortController` timeout but no circuit breaker — a slow asset-service will time-out every helpdesk ticket request. Circuit breaker state is per-process, not distributed — a 10-pod deployment has 10 independent breakers. |
| **Timeouts** | PRESENT | `gateway-service/src/runtime-config.ts:41`: `GATEWAY_UPSTREAM_TIMEOUT_MS` (default 15 s). External adapters: PFMS `TIMEOUT_MS = 15_000`, TRACES `15_000`, location routing `10_000`. `helpdesk-service` asset client: `ASSET_TIMEOUT_MS` (default 10 s). `AbortSignal.timeout()` used widely. | Intra-service timeouts between district and state link not configurable per-link. No timeout on outbox relay publication to queue. |
| **Bulkheads** | ABSENT | No thread-pool or concurrency-limiting bulkhead pattern found. No `Semaphore`/`MAX_CONCURRENT` constructs in service code. | All services share a single PostgreSQL connection pool; a slow module can exhaust connections for others. Required: per-module pool limits or connection partitioning. |
| **Schema registry** | PARTIAL | `packages/events/src/schema-registry.ts`: full implementation — `registerSchema()`, `validatePayload()`, `checkBackwardCompatibility()` with in-memory `Map`. Tests in `packages/events/tests/schema-registry.test.ts`. | **Never called from production service code.** Zero `registerSchema` calls found in `services/*/src`. Registry is effectively dormant. Event consumers cast blindly with `msg.payload as { … }`. |
| **Correlation IDs** | PRESENT | `genReqId: (req) => (req.headers["x-correlation-id"] ?? randomUUID())` in every `app.ts`. Routes extract and forward `correlationId`. Outbox envelope includes `correlationId`. Logs carry it via Fastify pino. | Not propagated as an HTTP header on *outbound* intra-service calls: `helpdesk-service/src/modules/cmdb/asset-client.ts` sends `x-tenant-id` but **no `x-correlation-id`**. Trace breaks at service boundary. |
| **Tenant context on messages** | PRESENT | `tenantId` is a mandatory field on the outbox envelope and all queue messages. `markProcessed` stores `tenantId`. RLS enforced by GUC `app.tenant_id`. | |
| **Jurisdiction context on messages** | ABSENT | Outbox schema (`packages/outbox/src/index.ts:38-49`): fields are `topic, eventType, tenantId, actorId, correlationId, payload`. No `jurisdictionId`, `officeId`, `orgUnitId`, `stateCode`, or `divisionId`. | **P0 for district federation.** Events cannot be selectively replicated to an office, routed to a district node, or consumed by a ministry fan-out subscriber without knowing origin jurisdiction. Add to envelope and all topics. |
| **Purpose-based access / field-level disclosure** | PARTIAL | `court-service/src/modules/party/routes.ts:16`: role-based PII masking documented (DPDP Act 2023 minimization). `court-service/src/shared/pii-crypto.ts`: field-level encryption at rest. `citizen-service`: DPDP §12 anonymise. `grant-service`: Aadhaar masking at command boundary. | No central purpose-code registry. Masking logic is per-service ad-hoc. No general `data_classification` or `sensitivity` column on tables. No enforcement at gateway for cross-tenant data exports. |

### A.2 Distributed-monolith check

```
grep -rn "http://.*-service|internalFetch|fetch(" services/*/src | grep -iv test | wc -l
→ 69
```

**Named worst offenders (synchronous cross-service chains):**

| Caller | Callee | File | Risk |
|---|---|---|---|
| `helpdesk-service` | `asset-service` | `modules/cmdb/asset-client.ts:40` | Every helpdesk ticket write blocks on asset-service HTTP call (no circuit breaker) |
| `hrms-service` | `payroll-service` | `shared/payroll-client.ts:110` | F&F calculation blocks on payroll HTTP (circuit-breaker present) |
| `gateway-service` | `identity-service` | `api-key-auth.ts:48` | Every API-key authenticated request blocks on identity HTTP |
| `gateway-service` | `policy-service` | `policy-check.ts:64` | Every request blocks on ABAC evaluation |
| `gateway-service` | `tenant-service` | `screen-manifest.ts:205` | Screen manifest blocks on tenant HTTP |
| `admin-service` | `gateway-service` | `modules/platform-config/routes.ts:213` | Platform config push blocks on gateway HTTP |
| `inventory-service` | `ml-service` | `modules/forecast/consumer.ts:58` | Demand forecast blocks on ML HTTP call |
| `crm-service` | `ml-service` | `modules/leads/ml-scoring.ts:155` | Lead scoring blocks on ML HTTP |

**Assessment:** 69 synchronous cross-service calls. The gateway→identity and gateway→policy chains are the critical P0 risk: every single request passes through two synchronous HTTP calls before reaching any domain service. In a district deployment where the WAN link to identity/policy is flaky, the entire platform fails. The `@civitasone/circuit-breaker` partially mitigates this on gateway→upstream but identity and policy checks bypass it.

---

## TASK B — Workflow Architecture Assessment

### B.1 Structural Assessment

The workflow-service has 18 modules (72+ source files). Structure:

```
modules/
  definitions/   — persisted graph (nodes+edges), version-pinned, BPMN/DMN
  instances/     — state machine per workflow run, sub-workflow (call-activity)
  tasks/         — human approval tasks, SLA/timer sweeper, reminder sweeper
  delegations/   — approval delegation (delegator→delegate, date-range)
  forwarding/    — forward/recall within the same instance
  history/       — immutable transition log
  dlq/           — application-level DLQ (consumer_attempts + dead_letters)
  provisioning/  — STANDARD_DEFINITIONS catalog seeded per tenant
  assignment/    — round-robin / least-loaded / hierarchy / authority-chain / matrix
  messages/      — message_catch/message_throw, correlation, timeout
  decisions/     — DMN decision tables (UNIQUE/FIRST/COLLECT/RULE_ORDER)
  simulation/    — path simulation with context variants
  bpmn/          — BPMN import/export routes
  designer/      — visual designer layout
  compensation/  — reverse-order compensation handler chain
  analytics/     — workflow KPI queries
  admin/         — dead-letter management, requeue
  external-tasks/ — external task polling API
```

**[VERIFIED] Does workflow-service maintain state?** Yes — `workflow.instances` table with `status`, `currentNode`, `completedNodes[]`, `context jsonb`, `callDepth`, `parentInstanceId`. Version-pinned (`definitionVersion`).

**[VERIFIED] Does it route tasks?** Yes — graph-driven advance in `tasks/consumer.ts:advanceFrom()` traverses `definition_edges` evaluating `condition` expressions via `shared/condition.ts:evaluateCondition()`.

**[VERIFIED] Does it manage approval with delegation?** Yes — `delegations/schema.ts`: `workflow_delegations` table with `delegatorId`, `delegateId`, `fromDate`, `toDate`, `isActive`. Delegation checked during task claim (date-bound, role-scoped).

**[VERIFIED] Does it enforce SLA?** Yes — `tasks/sweeper.ts:sweepOverdueTasks()` runs on `SLA_SWEEP_MS` interval (default 30 s); stamps `escalatedAt`, bumps `escalationCount`, emits escalation event + notification via outbox. Reminder sweeper at `tasks/sweeper.ts:startReminderSweeper()` for pre-breach alerts.

**[VERIFIED] Does it record history?** Yes — `history/repo.ts` writes to `workflow.transition_history` on every node transition, escalation, delegation, forward/recall.

**[VERIFIED] Does it invoke domain APIs (good) vs own all business data (bad)?** Mixed:
- GOOD: On task completion, workflow emits events to domain services via outbox (e.g. `DISPATCH.leaveApprove` → `hrms.leave.approve`). Does NOT write to other service DBs.
- COUPLING SMELL: `workflow-service/src/topics.ts:28-36`: `DISPATCH` map hardcodes 8 specific domain event topics (`hrms.leave.approve`, `payroll.run.approve`, `estab.file.approve`, `asset.dispose.approve`, `procurement.indent.approve`, `procurement.po.approve`). Adding a new domain requires editing `workflow-service` source.
- COUPLING SMELL: `tasks/routes.ts:25-26`: hardcodes `refType → topic` map inline in the route handler (`leave_app: "hrms.leave.approve"`, `payroll_run: "payroll.run.approve"`). This is a second copy of the same hardcoded map.

### B.2 Government Workflow Feature Matrix

| Feature | Status | Evidence |
|---|---|---|
| Department workflow templates | PARTIAL | `provisioning/catalog.ts`: `STANDARD_DEFINITIONS` — 5 linear chains (`file_noting`, `leave_approval`, `finance_approval`, `procurement_approval`, `grant_disbursement`) seeded per tenant. Graph-based — any topology is possible. `isTemplate` boolean on definitions. |
| State-specific templates | ABSENT | No state-template table. Templates are per-tenant only, not per-state. No inheritance: a state secretariat cannot publish a base workflow that districts override. |
| District overrides | ABSENT | No `parentDefinitionId` or `overrideOf` concept. Each district tenant is independent — a state change to a definition does not propagate. |
| Office-level config | ABSENT | No `officeId` or `jurisdictionId` on definitions, instances, or tasks. A definition cannot restrict which office-types may start it. |
| Versioned definitions | PRESENT | `definitions.version integer`, version-pinned on instances (`definitionVersion`). |
| Effective dates | ABSENT | No `effectiveFrom` / `effectiveTo` on definitions. An organisation cannot activate a new form/procedure for a future date. |
| Conditional routing | PRESENT | `definition_edges.condition varchar(512)` evaluated by `shared/condition.ts:evaluateCondition()`. DMN decision tables via `decisions/` module. `simulation/domain.ts` supports context variants. |
| Multi-department workflow | ABSENT | No `departmentId` on task or instance. A festival-permission workflow spanning Collector+Police+Fire+Health cannot model department-specific approvers — all participants are `roleRef` strings with no org-unit scope. |
| Cross-domain handoff | PARTIAL | `messages/` module: `message_catch/message_throw` nodes allow an event from one service to resume a waiting instance. But the tenant boundary is not crossed — all instances share a tenant; cross-department means cross-`roleRef` within the same tenant-scoped DB. |

### B.3 Critical Gap: DISPATCH Hardcoding

[VERIFIED] `workflow-service/src/topics.ts:28-36` and `tasks/consumer.ts:dispatchDomainApprove()`:

```typescript
// topics.ts — hardcoded, workflow-service must change to add any new domain
export const DISPATCH = {
  leaveApprove:       "hrms.leave.approve",
  payrollRunApprove:  "payroll.run.approve",
  indentApprove:      "procurement.indent.approve",
  poApprove:          "procurement.po.approve",
  fileApprove:        "estab.file.approve",
  fileReject:         "estab.file.reject",
  fileLevelApproved:  "estab.file.level_approved",
  assetDisposeApprove:"asset.dispose.approve",
};
```

A court-management, RTI, or inter-district workflow cannot complete without adding a new `DISPATCH` entry and redeploying workflow-service. This must become config-driven.

**[PROPOSED] Fix — config-driven dispatch table:**
```sql
-- new table in workflow DB
CREATE TABLE workflow.dispatch_rules (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID NOT NULL,
  ref_type   VARCHAR(64) NOT NULL,        -- "leave_app", "rti_application", etc.
  decision   VARCHAR(32) NOT NULL,        -- "approve", "reject"
  topic      VARCHAR(128) NOT NULL,       -- target event topic
  id_key     VARCHAR(64) NOT NULL DEFAULT 'id',
  effective_from TIMESTAMPTZ,
  effective_to   TIMESTAMPTZ,
  UNIQUE (tenant_id, ref_type, decision)
);
```

---

## TASK C — Integration Failure Testing

### C.1 Resilience behaviour matrix

| Scenario | Status | Evidence |
|---|---|---|
| **State-system unavailable** (PFMS/TRACES/GSTN) | IMPLEMENTED | Circuit-breaker + timeout + graceful-null in all external adapters: `finance-service/src/modules/pfms/adapter.ts:79` (breaker), `finance-service/src/modules/traces/adapter.ts:83` (breaker), `billing-service/src/modules/gstn/adapter.ts:78` (breaker). Adapters return structured error on open-circuit. |
| **Ministry-API unavailable** | PARTIAL | Adapters have circuit-breakers. But no **store-and-forward**: if PFMS is down when a payment is due, the outbox message sits undelivered. Outbox relay will keep retrying forever — **no max-retry on relay** side. |
| **Delayed events** | IMPLEMENTED | `markProcessed()` idempotency guard handles delayed/duplicated delivery at consumer. Outbox row `publishedAt IS NULL` re-relay handles delayed broker ack. |
| **Duplicate events** | IMPLEMENTED | `markProcessed()` — atomic INSERT ON CONFLICT DO NOTHING. |
| **Out-of-order events** | PARTIAL | Outbox FIFO by `MessageGroupId = tenantId` on SQS (queue-service). Within a tenant, ordering is preserved. Cross-tenant OOO is possible. No sequence-number or causal ordering on events. |
| **Schema mismatch** | ABSENT | Schema registry (`packages/events/src/schema-registry.ts`) exists but is **never wired to consumers**. Consumers cast `msg.payload as { … }` without validation. A schema-breaking change silently corrupts data. |
| **Invalid signature** | PARTIAL | JWT validation at gateway via `@civitasone/auth`. Internal service calls use `INTERNAL_SERVICE_SECRET` header but validation is service-specific; some clients (`helpdesk/cmdb/asset-client.ts`) send `x-tenant-id` only — no signature. |
| **Expired cert** | ABSENT | No cert-expiry handling or OCSP stapling found in service code. |
| **Partial data** | PARTIAL | `helpdesk/cmdb/asset-client.ts:45`: graceful degradation — returns `verified: false` on 404/5xx/timeout, ticket still accepted. Similar pattern in `citizen-service/modules/ai/adapter.ts`. Not universal. |
| **Queue backlog** | PARTIAL | Outbox relay batch=100 rows per cycle. Circuit-breaker on queue publish missing — a backlogged queue could pile up outbox rows indefinitely. No `outbox_lag` metric or alerting. |
| **District offline / network partition** | PARTIAL | The transactional outbox provides **logical store-and-forward** at the service level: data is committed to Postgres first; the relay will keep retrying publication. If the district's SQS/Kafka link is down, `published_at` stays null and events accumulate. This works **only if the district runs its own queue broker**. If the district shares a central SQS, a WAN partition means the relay loop never publishes — deadlock on all writes. No explicit district-offline mode, no local-first queue. |
| **State-link failure** | PARTIAL | Same as above. Outbox gives durability but no explicit failover to a local broker. No `district_online` flag or graceful degradation to local-only mode. |
| **Retry exhaustion** | PARTIAL | `workflow-service` DLQ: after `WORKFLOW_DLQ_MAX_ATTEMPTS` (default 5), message is dead-lettered to `workflow.dead_letters`. Admin can requeue. Other services: re-throw forever — retry exhaustion is unbounded. |
| **Reconciliation failure** | ABSENT | No reconciliation saga or compensating-transaction orchestrator beyond `workflow-service/src/modules/compensation/executor.ts` (workflow graph compensation only). Finance GL reconciliation (`services/finance-service/tests/recon-db.test.ts` — untracked file) is a test file, not a deployed reconciliation process. |

### C.2 Outbox District-Offline Verification

[VERIFIED] Outbox relay path:
1. Consumer writes business row + `_outbox.messages` row in **single transaction** → `packages/outbox/src/index.ts:enqueue()`
2. `startRelay()` polls every 500 ms (default), publishes to queue, marks `published_at`
3. On relay failure: `incrementOutboxRelayFailure(service)` + logs + **skips row** (retries next cycle)
4. No relay-side max-retry or DLQ — an unpublishable row will never be moved

**Conclusion:** If the district node runs a local queue broker (e.g. local RabbitMQ), the outbox provides store-and-forward during WAN partition. If the district relies on a central cloud SQS, the outbox accumulates rows indefinitely but nothing ships to the consumer. The current architecture does not enforce local queue provisioning; there is no documented district deployment topology.

**[PROPOSED] District offline mode:**
1. Each district node runs a local queue broker (RabbitMQ/Kafka in K8s).
2. Add env `QUEUE_MODE=local|federated`. Local = in-cluster broker. Federated = WAN broker.
3. Add `outbox_lag_seconds` metric and alerting threshold.
4. Add relay max-retry: after N failures, mark row `stalled` and emit an alert.

---

## TASK D — Configurability Register

### D.1 Hardcoded State-Specific Items

The following table covers items that currently require a **code fork** to change across states/departments/tiers. Every "Hardcoded" row is a code-fork risk for multi-state deployment.

| Item | Current | Evidence | Required Change | Priority |
|---|---|---|---|---|
| **Administrative unit type enum** | Hardcoded TypeScript enum | `location-service/src/modules/hierarchy/schema.ts:5-12`: `pgEnum("unit_type", ["state","district","block","gp","ward","zone"])`. `location-service/src/modules/jurisdiction/validators.ts:4`: `JURISDICTION_LEVELS = ["state","district","block","gp","ward","zone"]`. Telangana uses "Mandal", UP uses "Tehsil", NE states use "Circle". | Config-driven: read active `unit_type` set from `location.unit_type_config(tenant_id)`. Enum becomes a lookup; validator reads DB. | P0 |
| **Workflow DISPATCH map** | Hardcoded TypeScript | `workflow-service/src/topics.ts:28-36`: 8 hardcoded `refType → topic` entries. `tasks/routes.ts:25-26`: duplicate in-route map. | `workflow.dispatch_rules` table (DDL in §B.3). Route handler loads rules from cache. | P0 |
| **STANDARD_DEFINITIONS catalog** | Hardcoded TypeScript | `workflow-service/src/modules/provisioning/catalog.ts`: 5 linear chains with hardcoded role names (`estab_user`, `estab_section_officer`, etc.). These role names are Bihar/GoI-centric. | Move to seeded DB rows with `is_template = true`. State government uploads their template set. Role names become `role_code` referencing `identity.roles`. | P0 |
| **Workflow jurisdiction context** | Absent | No `jurisdictionId`/`officeId` on instances/tasks/definitions schema. | Add `office_id UUID`, `jurisdiction_id UUID`, `org_unit_type VARCHAR(32)` to `workflow.definitions` and `workflow.instances`. | P0 |
| **Grievance SLA** | Hardcoded TypeScript | `citizen-service/src/modules/grievance/domain.ts:7`: `GRIEVANCE_ESCALATION_SLA_DAYS = 7`. State-specific per CPGRAMS circular. | Read from `citizen.sla_config(tenant_id, service_type)` table. | P1 |
| **Helpdesk SLA by priority** | Hardcoded default | `helpdesk-service/src/modules/sla/domain.ts:111`: `DEFAULT_SLA_POLICIES[]` with hardcoded days. DB override path exists (`listSlaByTenant`) but falls back to hardcoded defaults. | Move defaults to seeded DB rows per tenant at install time. Remove code default. | P1 |
| **Jurisdiction levels** | Hardcoded TypeScript enum | `location-service/src/modules/jurisdiction/validators.ts:4`: `["state","district","block","gp","ward","zone"]`. Fixed 6 levels; cannot model division, sub-division, tehsil, mandal, taluk, taluka, circle, firka. | `location.jurisdiction_level_config(tenant_id, level_code, label, depth_order)` table. Validator reads from cache. | P0 |
| **Notification template language** | Single-language only | `notification-service/src/modules/templates/schema.ts`: `templates` table has no `language_code` column. One body per template. | Add `language_code VARCHAR(8) DEFAULT 'en'` to templates table. UI/gateway sends `Accept-Language`; notification-service picks matching template. | P1 |
| **Integration endpoint URLs** | Config (env vars) | `PFMS_BASE_URL`, `TRACES_BASE_URL`, `GSTN_BASE_URL` all read from `process.env`. Circuit-breaker parameters are hardcoded. | GOOD — URLs are env-driven. Add circuit-breaker params to env/config too (`PFMS_CB_THRESHOLD`, `PFMS_CB_RECOVERY_MS`). | P2 |
| **Ministry reporting schemas (HOA, DDO, scheme codes)** | Partial config | `finance-service/src/shared/pfms.ts:11`: `PFMS_HOA_REGEX = /^\d{18}$/` — hardcoded 18-digit format for GoI. State treasuries use different HOA formats. | Config: `finance.hoa_format_config(tenant_id, pattern)` table. Validator reads from cache. | P1 |
| **Designations / pay matrix** | DB-driven | `hrms-service/src/modules/pay-matrix/routes.ts:49`: reads `hrmsDesignations` table. `hrms-service/src/modules/employee/schema.ts:27`: `hrms_designations` is a DB table. | GOOD — designations are data, not code. |  |
| **Approval chain / competent authority** | Partial config | `workflow.dispatch_rules` is absent (see §B.3). Financial limits (e.g. Collector → up to ₹1 lakh, SDM → up to ₹25k) are not modelled anywhere — no `financial_approval_limit` table found. | Add `workflow.competent_authority_limits(tenant_id, role_code, resource_type, max_amount_minor)`. | P0 |
| **Office types / department codes** | Absent from schema | No `office_type` enum or department configuration table found in identity/location/estab. | Add `location.office_types(tenant_id, code, label, category)` table readable by workflow and identity. | P0 |
| **Court types / case types** | Config-driven (court-service) | `court-service/src/modules/config-registry/`: full namespace+key config store; `presets.ts` has `VERTICAL_PRESETS` for revenue/consumer/tribunal with idempotent seed. `effectiveAllowed()` in `domain.ts:76` gives tenant config precedence. | GOOD for court-service. Pattern should be replicated to location/workflow/finance. |  |
| **Delegation of Powers (DoP) rules** | Absent | No DoP table or competent-authority resolver found. GFR references noted in comments (`asset-service`, `finance-service`) but no config table. A state's DoP schedule is never loaded. | `policy.delegation_of_powers(tenant_id, designationCode, resource_type, action_code, max_amount_minor, effective_from, effective_to)` table. Policy-service evaluates. | P0 |
| **Retention / record schedule** | Partial | `meeting-service`: `retention_years` column on documents, `retentionYears ?? 5` fallback (`meeting-service/src/modules/document/consumer.ts:162`). Other services: no retention config. | Add `admin.retention_schedule(tenant_id, record_type, retention_years)` table. | P2 |
| **Dashboard / report templates** | Absent from config | `report-service/src/modules/templates/schema.ts`: `report_template_status` enum (`active/draft/archived`) — templates are DB rows. Report definitions are tenant-config-driven through report-service. | GOOD. |  |
| **SLA timers in workflow** | Config per node | `definition_nodes.sla_minutes` — per-node SLA is data. Escalation cooldown is env (`SLA_ESCALATION_COOLDOWN_MS`). | GOOD for workflow. Extend to citizen-service and helpdesk. |  |
| **Languages supported (NLU/chatbot)** | Hardcoded | `hrms-service/src/modules/ai-ml/nlu-chatbot.ts:34`: `z.enum(["en","hi"])`. | Config: `admin.supported_languages(tenant_id, lang_code, label)`. Read at NLU boundary. | P2 |
| **GFR/DFPR rule versions** | Hardcoded references | Comments in `finance-service` and `asset-service` cite GFR Rule numbers. Rule thresholds (e.g. procurement limit) not in config. | Add `finance.regulatory_thresholds(tenant_id, rule_code, amount_minor, effective_from)`. | P1 |

### D.2 Court service config-registry as the pattern to replicate

[VERIFIED] `court-service/src/modules/config-registry/domain.ts` provides:
- Namespace+key config store with `NAMESPACE_PATTERN` and `KEY_PATTERN` validation
- `effectiveAllowed(configuredKeys, fallback)` — tenant config overrides platform default
- `deriveConfigId()` — deterministic ID for idempotent upserts
- `KNOWN_NAMESPACES` — documented intent without restriction
- `VERTICAL_PRESETS` — one-call tenant onboarding

**[PROPOSED P0]** Promote this pattern to a platform `config-service` or package:
```
packages/config-registry/
  src/
    client.ts         — read config from config-service REST API, cache in Redis
    validator.ts      — NAMESPACE_PATTERN, KEY_PATTERN
    effectiveSet.ts   — effectiveAllowed()
```

All services replace hardcoded enums with `configClient.getEffectiveSet(tenantId, namespace, defaults)`.

---

## Summary Gap Table (All Tasks)

| # | Gap | Task | Priority |
|---|---|---|---|
| G1 | Jurisdiction context absent from event envelope and workflow schema | A, B | P0 |
| G2 | `DISPATCH` map hardcoded in workflow-service | B | P0 |
| G3 | Administrative unit type enum hardcoded (`state/district/block/gp/ward/zone`) | D | P0 |
| G4 | Jurisdiction levels hardcoded (cannot model tehsil, mandal, division, taluk) | D | P0 |
| G5 | Delegation of Powers / competent-authority config absent | D | P0 |
| G6 | Office-type / department-code config absent | D | P0 |
| G7 | Financial approval limits not modelled | D | P0 |
| G8 | Schema registry never wired to production consumers | A | P1 |
| G9 | DLQ only in workflow + court service; 34+ consumers have unbounded retry | C | P1 |
| G10 | No distributed circuit-breaker (per-process state; 10 pods = 10 breakers) | A | P1 |
| G11 | Intra-service HTTP calls missing `x-correlation-id` propagation | A | P1 |
| G12 | District offline mode absent; outbox store-and-forward requires local queue broker (undocumented) | C | P1 |
| G13 | Workflow STANDARD_DEFINITIONS hardcoded in TypeScript with GoI-centric role names | B, D | P0 |
| G14 | No state-template inheritance / district override for workflow definitions | B | P1 |
| G15 | Workflow instances/tasks lack `officeId` / `jurisdictionId` scoping | B | P0 |
| G16 | Schema mismatch on events: no runtime payload validation at consume boundary | C | P1 |
| G17 | `GRIEVANCE_ESCALATION_SLA_DAYS = 7` hardcoded; state varies 5–30 days | D | P1 |
| G18 | HOA format (18-digit) hardcoded for GoI PFMS; state treasuries differ | D | P1 |
| G19 | No `effective_from`/`effective_to` on workflow definitions | B | P1 |
| G20 | Multi-department workflow impossible (no `departmentId` on task) | B | P1 |
| G21 | No bulkhead / DB connection partitioning per module | A | P2 |
| G22 | No jitter on retry backoff (thundering-herd risk on district restart) | C | P2 |
| G23 | Notification templates: no `language_code` column | D | P1 |
| G24 | Outbox relay: no max-retry; unpublishable rows accumulate silently | C | P1 |

---

## Implementable Remediation (Monday-start)

### 1. Add jurisdiction context to event envelope (G1) — P0

```typescript
// packages/outbox/src/index.ts — extend outboxMessages table
export const outboxMessages = outbox.table("messages", {
  // … existing fields …
  jurisdictionId: uuid("jurisdiction_id"),   // nullable — batch/system events have none
  officeId:       uuid("office_id"),
  orgUnitType:    varchar("org_unit_type", { length: 32 }), // e.g. "district", "block"
});

// packages/events/src/envelope.ts — extend envelope schema
export const eventEnvelopeSchema = z.object({
  // … existing …
  jurisdictionId: z.string().uuid().optional(),
  officeId:       z.string().uuid().optional(),
  orgUnitType:    z.string().optional(),
});
```

Migration: `ALTER TABLE _outbox.messages ADD COLUMN jurisdiction_id UUID, ADD COLUMN office_id UUID, ADD COLUMN org_unit_type VARCHAR(32);`

### 2. Config-driven dispatch (G2) — P0

```sql
-- workflow DB
CREATE TABLE workflow.dispatch_rules (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL,
  ref_type       VARCHAR(64) NOT NULL,
  decision       VARCHAR(32) NOT NULL DEFAULT 'approve',
  topic          VARCHAR(128) NOT NULL,
  id_key         VARCHAR(64) NOT NULL DEFAULT 'id',
  effective_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  effective_to   TIMESTAMPTZ,
  created_by     UUID NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, ref_type, decision)
);
```

Replace `dispatchDomainApprove()` lookup map with `SELECT topic, id_key FROM workflow.dispatch_rules WHERE tenant_id=$1 AND ref_type=$2 AND decision=$3 AND now() BETWEEN effective_from AND COALESCE(effective_to, 'infinity')`.

### 3. Config-driven admin unit types (G3, G4) — P0

```sql
-- location DB
CREATE TABLE hierarchy.unit_type_config (
  tenant_id  UUID NOT NULL,
  code       VARCHAR(32) NOT NULL,
  label      VARCHAR(128) NOT NULL,
  depth      INTEGER NOT NULL,           -- 1=state, 2=division/district, 3=block/tehsil, …
  lgd_level  VARCHAR(32),               -- LGD canonical level code
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, code)
);
```

Seed: GoI default = `state(1), district(2), block(3), gp(4), ward(5)`. UP seed adds `division(2), tehsil(3)`. Telangana seed uses `mandal(3)`. The TypeScript enum `unitTypeEnum` is removed; validator reads from this table (Redis-cached).

### 4. Wire schema registry to consumers (G8) — P1

```typescript
// packages/outbox/src/index.ts — inside relayOnce, before queue.publish:
import { validatePayload } from "@civitasone/events";
validatePayload(row.eventType, row.payload.schemaVersion ?? "1.0", row.payload);
// On SchemaRegistryError: move row to dead-letter rather than retrying
```

### 5. Add jurisdiction fields to workflow (G15) — P0

```sql
-- workflow DB
ALTER TABLE workflow.definitions ADD COLUMN allowed_office_types TEXT[];
ALTER TABLE workflow.instances   ADD COLUMN office_id UUID;
ALTER TABLE workflow.instances   ADD COLUMN jurisdiction_id UUID;
ALTER TABLE workflow.tasks       ADD COLUMN office_id UUID;
```

### 6. Delegation of Powers table (G5, G7) — P0

```sql
-- policy DB
CREATE TABLE policy.delegation_of_powers (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  designation_code  VARCHAR(64) NOT NULL,
  resource_type     VARCHAR(64) NOT NULL,   -- "finance.sanction", "procurement.po", etc.
  action_code       VARCHAR(32) NOT NULL,   -- "approve", "sanction", "write_off"
  max_amount_minor  BIGINT,                 -- null = unlimited
  currency          CHAR(3) NOT NULL DEFAULT 'INR',
  effective_from    TIMESTAMPTZ NOT NULL,
  effective_to      TIMESTAMPTZ,
  rule_reference    VARCHAR(128),           -- e.g. "GFR Rule 173", "DFPR para 64"
  created_by        UUID NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

---

## Scoring

| Dimension | Score | Rationale |
|---|---|---|
| Loose coupling | 5/10 | Outbox + idempotent consumers are solid; circuit-breakers present on externals. Fails on: no jurisdiction envelope, schema registry dormant, intra-service HTTP chains, no bulkhead. |
| Workflow architecture | 6/10 | Rich feature set (DMN, sub-workflows, delegation, SLA, simulation, compensation). Fails on: DISPATCH hardcoding, no jurisdiction scoping, no cross-department modelling, no state-template inheritance. |
| Failure/resilience | 5/10 | Outbox store-and-forward exists; circuit-breakers on externals. Fails on: no district-offline mode, DLQ only in 2/38 services, no schema validation at consume, schema mismatch silent, no reconciliation saga. |
| Configurability | 4/10 | Court-service config-registry is excellent and shows the pattern. Fails on: jurisdiction level/unit-type hardcoded, DISPATCH hardcoded, DoP absent, multi-language absent, GFR thresholds absent, no state-template inheritance. |

---

LANE_DONE L09 score=5

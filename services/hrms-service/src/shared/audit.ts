/**
 * Audit log writer for HRMS mutating actions.
 * Fire-and-forget: never throws, never delays a response.
 */
import { pino } from "pino";
import { withRawTenantGuc } from "@civitasone/db";
import { sqlClient } from "./db.js";

const log = pino({ name: "hrms.audit" });

interface AuditEntry {
  tenantId: string;
  actorId: string | null;
  actorType: string | null;
  actorRoles: string[];
  method: string;
  path: string;
  statusCode: number;
  requestId: string | null;
  ipAddr: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ENTITY_SEGMENTS: Record<string, string> = {
  employees: "employee",
  leave: "leave",
  attendance: "attendance",
  payroll: "payroll",
  recruitment: "recruitment",
  departments: "department",
  designations: "designation",
  locations: "location",
  holidays: "holiday",
  onboarding: "onboarding",
  "onboarding-tasks": "onboarding_task",
  "onboarding-documents": "onboarding_document",
  training: "training",
  appraisals: "appraisal",
  transfers: "transfer",
  promotions: "promotion",
  separations: "separation",
};

function parseEntity(path: string): { entityType: string | null; entityId: string | null } {
  const pathname = path.split("?")[0] ?? path;
  const parts = pathname.split("/").filter(Boolean);
  const hrmsIdx = parts.indexOf("hrms");
  if (hrmsIdx < 0) return { entityType: null, entityId: null };
  const seg = parts[hrmsIdx + 1] ?? null;
  const entityType = seg ? (ENTITY_SEGMENTS[seg] ?? seg) : null;
  const idSeg = parts[hrmsIdx + 2] ?? null;
  const entityId = idSeg && UUID_RE.test(idSeg) ? idSeg : null;
  return { entityType, entityId };
}

export async function writeAuditLog(entry: AuditEntry): Promise<void> {
  const { entityType, entityId } = parseEntity(entry.path);
  const insertSql = `INSERT INTO audit.hr_action_log
       (tenant_id, actor_id, actor_type, actor_roles, method, path, entity_type, entity_id, status_code, request_id, ip_addr)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`;
  const params = [
    entry.tenantId,
    entry.actorId,
    entry.actorType,
    entry.actorRoles,
    entry.method,
    entry.path,
    entityType,
    entityId,
    entry.statusCode,
    entry.requestId,
    entry.ipAddr,
  ];
  try {
    // TX-013: audit.hr_action_log is RLS ENABLEd + FORCEd (per-tenant audit
    // trail, same convention as the rest of hrms-service — see
    // migrations/0135_audit_hr_action_log.sql). This insert is a bare
    // sqlClient call with no Drizzle schema attached, so there is no
    // db.transaction() to auto-set app.tenant_id via AsyncLocalStorage (that
    // wiring only intercepts db.transaction() — see
    // packages/db/src/tenant-tx.ts). Without withRawTenantGuc here, the
    // FORCE-RLS WITH CHECK would fail CLOSED on every insert (current_setting
    // unset -> NULL -> tenant_id = NULL never true), silently swapping the
    // original "relation does not exist" failure for an equally silent RLS
    // failure. Same defect class documented in
    // packages/db/src/raw-tenant-guc.ts (also hit by helpdesk-service,
    // crm-service, estab-service and payroll-service).
    //
    // TX-015: this used to feature-check `typeof sqlClient.begin ===
    // "function"` and fall back to a direct (non-tenant-scoped) `.unsafe()`
    // call when it was missing, purely to accommodate ~28 test doubles for
    // `../shared/db.js` that stubbed `sqlClient` as `{ end: ... }` with no
    // `.begin`. That silently exercised the pre-TX-013 fallback path instead
    // of withRawTenantGuc in every one of those files' tests -- no coverage
    // of the tenant-scoping behavior it's supposed to guarantee. The real
    // postgres.js client (production, and any real-DB integration test)
    // always implements `.begin` (see packages/db/src/pool.ts), so the
    // fallback served no production purpose. Fixed by giving those doubles a
    // real `.begin` (tests/fixtures/mock-sql-client.ts) instead of routing
    // around the gap here; the fallback is gone now that nothing needs it.
    await withRawTenantGuc(sqlClient, entry.tenantId, (tx) => tx.unsafe(insertSql, params));
  } catch (err) {
    log.error({ err }, "[audit] write failed");
  }
}

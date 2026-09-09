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
    // `sqlClient.begin` feature-check: dozens of pre-existing route test
    // files stub `../shared/db.js`'s `sqlClient` as a bare callable (tagged
    // template only, for their own route code) with no `.begin()` — they
    // never touch a real, RLS-enforcing database, so app.ts's onResponse
    // hook firing this for every mutating response in every one of those
    // files would otherwise throw "sqlClient.begin is not a function" on
    // every request, purely from a test double gap unrelated to what those
    // tests exercise. Rather than retrofit .begin() onto every such mock,
    // fall back to the original (pre-TX-013) direct `.unsafe()` call shape
    // when `.begin` isn't present — those tests keep working unmodified. The
    // real postgres.js client (production, and any real-DB integration test)
    // always implements `.begin`, so this fallback is never taken outside a
    // deliberately partial test double.
    if (typeof sqlClient.begin === "function") {
      await withRawTenantGuc(sqlClient, entry.tenantId, (tx) => tx.unsafe(insertSql, params));
    } else {
      await sqlClient.unsafe(insertSql, params);
    }
  } catch (err) {
    log.error({ err }, "[audit] write failed");
  }
}

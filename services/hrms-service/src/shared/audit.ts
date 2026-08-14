/**
 * Audit log writer for HRMS mutating actions.
 * Fire-and-forget: never throws, never delays a response.
 */
import { sqlClient } from "./db.js";

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
  try {
    await sqlClient.unsafe(
      `INSERT INTO audit.hr_action_log
         (tenant_id, actor_id, actor_type, actor_roles, method, path, entity_type, entity_id, status_code, request_id, ip_addr)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
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
      ],
    );
  } catch (err) {
    console.error("[audit] write failed", err);
  }
}

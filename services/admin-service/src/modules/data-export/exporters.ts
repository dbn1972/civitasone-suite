/**
 * OWNER DECISION #22 (TENANT-ADMIN-DATA-EXPORT-03): the data an export can carry.
 *
 * admin-service can only read what admin-service owns, so the registry below is
 * the honest list of entities an export produces today: each exporter selects an
 * explicit, non-secret column list for ONE tenant (never `select *`, so a secret
 * column added later cannot leak into a file). A request that names a module or
 * entity with no exporter FAILS with a machine reason rather than producing an
 * empty file that looks like a success.
 */
import { eq } from "drizzle-orm";
import type { db } from "../../shared/db.js";
import { featureFlags } from "../feature-flags/schema.js";
import { customDomains } from "../custom-domains/schema.js";
import { departmentTemplates } from "../dept-templates/schema.js";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type Row = Record<string, unknown>;

export interface EntityExporter {
  entity: string;
  module: string;
  columns: string[];
  load(tx: Tx, tenantId: string): Promise<Row[]>;
}

const iso = (d: Date | null | undefined): string => (d ? d.toISOString() : "");

export const EXPORTERS: EntityExporter[] = [
  {
    entity: "feature_flags",
    module: "admin",
    columns: ["id", "key", "name", "description", "enabled", "rolloutPercent", "killSwitch", "owner", "expiresAt", "createdAt", "updatedAt"],
    async load(tx, tenantId) {
      const rows = await tx.select().from(featureFlags).where(eq(featureFlags.tenantId, tenantId));
      return rows.map((r) => ({
        id: r.id, key: r.key, name: r.name, description: r.description, enabled: r.enabled,
        rolloutPercent: r.rolloutPercent, killSwitch: r.killSwitch, owner: r.owner,
        expiresAt: iso(r.expiresAt), createdAt: iso(r.createdAt), updatedAt: iso(r.updatedAt),
      }));
    },
  },
  {
    entity: "custom_domains",
    module: "admin",
    // verification_token is a secret challenge value and is deliberately NOT exported.
    columns: ["id", "domain", "status", "verificationMethod", "verifiedAt", "sslStatus", "sslExpiresAt", "createdAt"],
    async load(tx, tenantId) {
      const rows = await tx.select().from(customDomains).where(eq(customDomains.tenantId, tenantId));
      return rows.map((r) => ({
        id: r.id, domain: r.domain, status: r.status, verificationMethod: r.verificationMethod,
        verifiedAt: iso(r.verifiedAt), sslStatus: r.sslStatus, sslExpiresAt: iso(r.sslExpiresAt), createdAt: iso(r.createdAt),
      }));
    },
  },
  {
    entity: "department_templates",
    module: "admin",
    columns: ["id", "code", "name", "status", "createdAt", "updatedAt"],
    async load(tx, tenantId) {
      const rows = await tx.select().from(departmentTemplates).where(eq(departmentTemplates.tenantId, tenantId));
      return rows.map((r) => ({ id: r.id, code: r.code, name: r.name, status: r.status, createdAt: iso(r.createdAt), updatedAt: iso(r.updatedAt) }));
    },
  },
];

export type Plan = { ok: true; exporters: EntityExporter[] } | { ok: false; reason: "NO_EXPORTER_FOR_MODULE" | "UNKNOWN_ENTITY" };

/** Which exporters a request covers. Pure, so every outcome is unit-testable. */
export function planExport(type: "full" | "module" | "entity", moduleFilter: string | null, entityId: string | null): Plan {
  if (type === "full") return { ok: true, exporters: EXPORTERS };
  if (type === "module") {
    const m = (moduleFilter ?? "").toLowerCase();
    const hit = EXPORTERS.filter((e) => e.module === m);
    return hit.length > 0 ? { ok: true, exporters: hit } : { ok: false, reason: "NO_EXPORTER_FOR_MODULE" };
  }
  const key = (entityId ?? "").toLowerCase();
  const hit = EXPORTERS.filter((e) => e.entity === key);
  return hit.length > 0 ? { ok: true, exporters: hit } : { ok: false, reason: "UNKNOWN_ENTITY" };
}

/**
 * RFC 4180 CSV. A cell starting with = + - @ (or a tab/CR) is prefixed with an
 * apostrophe so a spreadsheet never executes it as a formula (CSV injection).
 */
export function toCsv(columns: string[], rows: Row[]): string {
  const cell = (v: unknown): string => {
    let s = v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.join(","), ...rows.map((r) => columns.map((c) => cell(r[c])).join(","))].join("\r\n") + "\r\n";
}

import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import type { OpinionRow } from "./schema.js";
import { departmentNames } from "../../shared/org-client.js";

export type OpinionAddressee = { type: "department"; departmentId: string; name?: string } | { type: "external"; name: string } | null;

/** Owner decision #13: the stored addressee columns as one object; a department id is shown with its resolved name. */
export function toAddressee(row: Pick<OpinionRow, "addresseeType" | "addresseeDepartmentId" | "addresseeName">, names: Map<string, string>): OpinionAddressee {
  if (row.addresseeType === "department" && row.addresseeDepartmentId) {
    const name = names.get(row.addresseeDepartmentId);
    return { type: "department", departmentId: row.addresseeDepartmentId, ...(name ? { name } : {}) };
  }
  if (row.addresseeType === "external" && row.addresseeName) return { type: "external", name: row.addresseeName };
  return null;
}

/** Detail / list DTO: the row plus a resolved `addressee` (same shape in both). */
export async function withAddressee<T extends OpinionRow>(rows: T[], tenantId: string, correlationId: string): Promise<Array<T & { addressee: OpinionAddressee }>> {
  const needsNames = rows.some((r) => r.addresseeType === "department");
  const names = needsNames ? await departmentNames({ tenantId, correlationId }) : new Map<string, string>();
  return rows.map((r) => ({ ...r, addressee: toAddressee(r, names) }));
}

export async function getOpinion(id: string, tenantId: string): Promise<OpinionRow | null> {
  const row = await cache.getOrLoad<OpinionRow>(
    cache.makeKey(tenantId, "opinion", id),
    () => repo.findOpinionById(id),
  );
  if (row && row.tenantId !== tenantId) return null;
  return row;
}

export async function listOpinions(tenantId: string, status?: string, caseId?: string) {
  const cacheKey = cache.makeKey(tenantId, "opinions", `${status ?? "all"}:${caseId ?? "all"}`);
  return cache.getOrLoad(cacheKey, () => repo.listOpinions(tenantId, status, caseId));
}

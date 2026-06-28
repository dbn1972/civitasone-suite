import * as repo from "./repo.js";
import type { HandoverRow } from "./schema.js";

export type HandoverDto = {
  id: string;
  fromOfficerId: string;
  toOfficerId: string;
  reason: string;
  remarks: string | null;
  fileCount: number;
  status: string;
  effectiveFrom: string;
  completedAt: string | null;
  createdAt: string;
};

function toDto(r: HandoverRow): HandoverDto {
  return {
    id: r.id,
    fromOfficerId: r.fromOfficerId,
    toOfficerId: r.toOfficerId,
    reason: r.reason,
    remarks: r.remarks,
    fileCount: r.fileCount,
    status: r.status,
    effectiveFrom: r.effectiveFrom.toISOString(),
    completedAt: r.completedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}

export async function listHandovers(
  tenantId: string,
  filter: { status?: string | undefined },
  limit: number,
): Promise<HandoverDto[]> {
  const rows = await repo.listHandovers(tenantId, limit);
  return rows
    .filter((r) => (filter.status ? r.status === filter.status : true))
    .map(toDto);
}

import * as repo from "./repo.js";
import type { MigrationRow } from "./schema.js";

export type MigrationDto = {
  id: string;
  legacyFileNo: string;
  subject: string;
  dept: string;
  pageCount: number;
  scanRef: string | null;
  efileId: string | null;
  /** eFile number of the linked file (GAP-ESTAB-MIGRATION-04); null until linked / when not found. */
  efileNo: string | null;
  status: string;
  createdAt: string;
};

function toDto(r: MigrationRow, fileNos: Map<string, string> = new Map()): MigrationDto {
  return {
    id: r.id,
    legacyFileNo: r.legacyFileNo,
    subject: r.subject,
    dept: r.dept,
    pageCount: r.pageCount,
    scanRef: r.scanRef,
    efileId: r.efileId,
    efileNo: r.efileId ? (fileNos.get(r.efileId) ?? null) : null,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
  };
}

export async function listMigrations(
  tenantId: string,
  filter: { status?: string | undefined },
  limit: number,
): Promise<MigrationDto[]> {
  const rows = await repo.listMigrations(tenantId, limit);
  const shown = rows.filter((r) => (filter.status ? r.status === filter.status : true));
  const fileNos = await repo.fileNosByIds(tenantId, shown.flatMap((r) => (r.efileId ? [r.efileId] : [])));
  return shown.map((r) => toDto(r, fileNos));
}

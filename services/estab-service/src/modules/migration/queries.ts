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
  status: string;
  createdAt: string;
};

function toDto(r: MigrationRow): MigrationDto {
  return {
    id: r.id,
    legacyFileNo: r.legacyFileNo,
    subject: r.subject,
    dept: r.dept,
    pageCount: r.pageCount,
    scanRef: r.scanRef,
    efileId: r.efileId,
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
  return rows
    .filter((r) => (filter.status ? r.status === filter.status : true))
    .map(toDto);
}

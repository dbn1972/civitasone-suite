import * as repo from "./repo.js";

export interface CpioDirectoryEntry {
  id: string;
  name: string;
  designation: string | null;
  publicAuthority: string;
  department: string | null;
}

/**
 * GAP-CITIZEN-RTI-03 — directory projection for the picker. Returns ONLY the
 * fields needed to choose a CPIO by name/authority; email/phone are NOT exposed
 * to citizens (DPDP data minimisation), only the opaque id that becomes
 * `cpioRef` on the RTI request.
 */
export async function listCpios(tenantId: string, q: string | undefined, limit = 25): Promise<CpioDirectoryEntry[]> {
  const rows = await repo.searchCpios(tenantId, q, limit);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    designation: r.designation,
    publicAuthority: r.publicAuthority,
    department: r.department,
  }));
}

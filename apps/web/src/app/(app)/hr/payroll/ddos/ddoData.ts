/**
 * Pure helpers for /hr/payroll/ddos (GAP-PAYROLL-DDOS-01/02/03/05).
 */

export type DepartmentOption = { id: string; code: string; name: string };
export type DdoRecord = { ddoCode: string; name: string; departmentIds: string[] };

/**
 * DDO codes: letters, digits and - / _ . only (no spaces), 1-32 chars --
 * payroll.payroll_ddos.ddo_code is VARCHAR(32).
 */
export const DDO_CODE_RE = /^[A-Za-z0-9][A-Za-z0-9/_.-]{0,31}$/;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(v: string): boolean {
  return UUID_RE.test(v);
}

export function departmentLabel(id: string, departments: ReadonlyMap<string, DepartmentOption>): string {
  const d = departments.get(id);
  return d ? `${d.name} (${d.code})` : id;
}

export type DdoMappingDiff = {
  /** Departments newly mapped to this DDO. */
  added: string[];
  /** Departments that will no longer be mapped to this DDO. */
  removed: string[];
  /** Departments moving here from another DDO: id -> that DDO's code. */
  movedFrom: Map<string, string>;
  /** True when this code already exists (save updates it). */
  isUpdate: boolean;
};

/**
 * What a save will change (GAP-PAYROLL-DDOS-02): the POST replaces this
 * DDO's department set, and a department can only belong to one DDO, so
 * choosing one that is mapped elsewhere moves it.
 */
export function diffDdoMapping(ddoCode: string, nextIds: readonly string[], existing: readonly DdoRecord[]): DdoMappingDiff {
  const code = ddoCode.trim();
  const current = existing.find((d) => d.ddoCode === code);
  const before = new Set(current?.departmentIds ?? []);
  const after = new Set(nextIds);
  const movedFrom = new Map<string, string>();
  for (const id of after) {
    if (before.has(id)) continue;
    const owner = existing.find((d) => d.ddoCode !== code && d.departmentIds.includes(id));
    if (owner) movedFrom.set(id, owner.ddoCode);
  }
  return {
    added: [...after].filter((id) => !before.has(id)),
    removed: [...before].filter((id) => !after.has(id)),
    movedFrom,
    isUpdate: !!current,
  };
}

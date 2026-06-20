export type Edition = "govt_dept" | "psu" | "small_office";
export type TenantStatus = "draft" | "active" | "suspended" | "archived";

export type TenantView = {
  id: string;
  tenantId: string;
  name: string;
  domain: string;
  edition: Edition;
  status: TenantStatus;
  region: string;
  residency: string;
  settings: Record<string, unknown>;
  version: number;
};

const ALLOWED: Record<TenantStatus, TenantStatus[]> = {
  draft: ["active", "archived"],
  active: ["suspended", "archived"],
  suspended: ["active", "archived"],
  archived: [],
};

export function canTransition(from: TenantStatus, to: TenantStatus): boolean {
  return ALLOWED[from]?.includes(to) ?? false;
}

export function assertTransition(from: TenantStatus, to: TenantStatus): void {
  if (!canTransition(from, to)) {
    throw new DomainError("INVALID_TRANSITION", `cannot move tenant from ${from} to ${to}`);
  }
}

export class DomainError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "DomainError";
  }
}

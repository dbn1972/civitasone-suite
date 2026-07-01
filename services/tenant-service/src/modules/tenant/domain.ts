/** Pure domain logic — no DB, HTTP, queue. Unit-tested in isolation. */
import type { TenantStatus } from "@civitasone/types";

export type TenantView = {
  id: string;
  tenantId: string;
  name: string;
  domain: string;
  edition: "small_office" | "psu" | "govt" | "private" | "ngo" | "section8" | "cooperative";
  status: TenantStatus;
  region: string;
  residency: string;
  isolationTier: "pool" | "silo";
  settings: Record<string, unknown>;
  version: number;
};

const ALLOWED: Record<TenantStatus, TenantStatus[]> = {
  draft: ["active", "archived"],
  active: ["suspended", "restricted", "offboarding"],
  suspended: ["active", "offboarding"],
  restricted: ["active", "suspended"],
  offboarding: ["archived"],
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

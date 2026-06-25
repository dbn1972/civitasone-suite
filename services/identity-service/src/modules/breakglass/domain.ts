export type GrantStatus = "active" | "closed" | "expired";

export type GrantView = {
  id: string;
  tenantId: string;
  userId: string;
  reason: string;
  scope: string;
  status: GrantStatus;
  grantedBy: string;
  closedBy: string | null;
  closeReason: string | null;
  grantedAt: string;
  expiresAt: string;
  closedAt: string | null;
  version: number;
};

export class DomainError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "DomainError";
  }
}

// Break-glass TTL bounds (minutes). A grant must be short-lived; we cap it so an
// emergency grant cannot be opened "forever".
export const MIN_TTL_MINUTES = 5;
export const MAX_TTL_MINUTES = 240; // 4h hard ceiling

export function assertTtl(minutes: number): void {
  if (!Number.isInteger(minutes) || minutes < MIN_TTL_MINUTES || minutes > MAX_TTL_MINUTES) {
    throw new DomainError("INVALID_TTL", `ttlMinutes must be an integer in [${MIN_TTL_MINUTES}, ${MAX_TTL_MINUTES}]`);
  }
}

export function expiryFromNow(ttlMinutes: number, now = new Date()): Date {
  return new Date(now.getTime() + ttlMinutes * 60_000);
}

const ALLOWED: Record<GrantStatus, GrantStatus[]> = {
  active:  ["closed", "expired"],
  closed:  [],
  expired: [],
};

export function canTransition(from: GrantStatus, to: GrantStatus): boolean {
  return ALLOWED[from]?.includes(to) ?? false;
}

/** Is the grant currently conferring access (active and not past expiry)? */
export function isInForce(status: GrantStatus, expiresAt: Date, now = new Date()): boolean {
  return status === "active" && expiresAt.getTime() > now.getTime();
}

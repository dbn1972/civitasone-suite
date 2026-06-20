export type UserStatus = "active" | "suspended" | "locked" | "deactivated";

export type UserView = {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  empCode: string | null;
  status: UserStatus;
  mfaEnabled: boolean;
  version: number;
};

const ALLOWED: Record<UserStatus, UserStatus[]> = {
  active:      ["suspended", "locked", "deactivated"],
  suspended:   ["active", "deactivated"],
  locked:      ["active", "deactivated"],
  deactivated: [],
};

export function canTransition(from: UserStatus, to: UserStatus): boolean {
  return ALLOWED[from]?.includes(to) ?? false;
}

export function assertTransition(from: UserStatus, to: UserStatus): void {
  if (!canTransition(from, to)) {
    throw new DomainError("INVALID_TRANSITION", `cannot move user from ${from} to ${to}`);
  }
}

export class DomainError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "DomainError";
  }
}

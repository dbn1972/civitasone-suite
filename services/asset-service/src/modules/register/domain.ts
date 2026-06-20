export class DomainError extends Error {
  constructor(public code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = "DomainError";
  }
}

export type AssetStatus = "active" | "under_maintenance" | "transferred" | "disposed" | "written_off";

export function assertValidStatus(status: string): void {
  const valid: AssetStatus[] = ["active", "under_maintenance", "transferred", "disposed", "written_off"];
  if (!valid.includes(status as AssetStatus)) {
    throw new DomainError("INVALID_STATUS", `invalid asset status: ${status}`);
  }
}

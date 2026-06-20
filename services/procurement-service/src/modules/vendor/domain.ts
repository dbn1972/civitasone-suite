export class DomainError extends Error {
  constructor(public code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = "DomainError";
  }
}

export function assertNotBlacklisted(vendorType: string): void {
  if (vendorType === "blacklisted") {
    throw new DomainError("VENDOR_BLACKLISTED", "vendor is blacklisted and cannot be used");
  }
}

export function assertCanEmpanel(vendorType: string): void {
  if (vendorType === "blacklisted") {
    throw new DomainError("VENDOR_BLACKLISTED", "blacklisted vendor cannot be empanelled");
  }
}

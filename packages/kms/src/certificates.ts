/**
 * Certificate lifecycle tracking (CAP-082). Pure, storage-agnostic logic for
 * tracking certificates, their expiry, and renewal reminders. A service adopts
 * this by persisting `CertificateRecord`s and periodically calling
 * `dueForRenewal` to raise reminders.
 */
export type CertRenewalStatus = "ok" | "renew_soon" | "expiring" | "expired";

export interface CertificateRecord {
  id: string;
  commonName: string;
  serial?: string;
  issuer?: string;
  notBefore: Date;
  notAfter: Date;
}

export interface RenewalPolicy {
  /** Raise "renew_soon" this many days before expiry. Default 30. */
  renewSoonDays?: number;
  /** Escalate to "expiring" this many days before expiry. Default 7. */
  expiringDays?: number;
}

export function daysUntilExpiry(cert: Pick<CertificateRecord, "notAfter">, now = new Date()): number {
  return Math.floor((cert.notAfter.getTime() - now.getTime()) / 86_400_000);
}

export function isExpired(cert: Pick<CertificateRecord, "notAfter">, now = new Date()): boolean {
  return now.getTime() > cert.notAfter.getTime();
}

export function renewalStatus(cert: Pick<CertificateRecord, "notAfter">, policy: RenewalPolicy = {}, now = new Date()): CertRenewalStatus {
  const renewSoon = policy.renewSoonDays ?? 30;
  const expiring = policy.expiringDays ?? 7;
  const days = daysUntilExpiry(cert, now);
  if (days < 0) return "expired";
  if (days <= expiring) return "expiring";
  if (days <= renewSoon) return "renew_soon";
  return "ok";
}

/** Certificates that need a renewal reminder (renew_soon / expiring / expired). */
export function dueForRenewal<T extends Pick<CertificateRecord, "notAfter">>(certs: T[], policy: RenewalPolicy = {}, now = new Date()): T[] {
  return certs.filter((c) => renewalStatus(c, policy, now) !== "ok");
}

/**
 * In-memory registry — a convenience adopters can back with a DB. Keeps the
 * lifecycle logic in one place and is fully unit-testable.
 */
export class CertificateRegistry {
  private certs = new Map<string, CertificateRecord>();
  constructor(private readonly policy: RenewalPolicy = {}, private readonly clock: () => Date = () => new Date()) {}

  add(cert: CertificateRecord): void {
    if (cert.notAfter <= cert.notBefore) throw new Error("notAfter must be after notBefore");
    this.certs.set(cert.id, cert);
  }
  get(id: string): CertificateRecord | undefined { return this.certs.get(id); }
  list(): CertificateRecord[] { return [...this.certs.values()]; }
  statusOf(id: string): CertRenewalStatus {
    const c = this.certs.get(id);
    if (!c) throw new Error(`unknown certificate ${id}`);
    return renewalStatus(c, this.policy, this.clock());
  }
  reminders(): Array<{ cert: CertificateRecord; status: CertRenewalStatus; daysLeft: number }> {
    const now = this.clock();
    return dueForRenewal(this.list(), this.policy, now).map((cert) => ({
      cert, status: renewalStatus(cert, this.policy, now), daysLeft: daysUntilExpiry(cert, now),
    }));
  }
}

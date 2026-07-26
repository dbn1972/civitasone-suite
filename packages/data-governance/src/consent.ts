/**
 * CAP-084 — consent & purpose registry.
 *
 * DPDP requires processing to be tied to a specific, notified PURPOSE for which
 * the Data Principal has given consent. This provides a purpose registry and a
 * pluggable consent store, plus a gate (`assertConsent`) callers use before
 * processing personal data for a purpose.
 */
export interface Purpose {
  key: string;
  description: string;
  /** When true, processing is lawful without consent (e.g. legal obligation). */
  legitimateUse?: boolean;
}

export type ConsentState = "granted" | "withdrawn";

export interface ConsentRecord {
  subjectId: string;
  purposeKey: string;
  state: ConsentState;
  at: Date;
}

export interface ConsentStore {
  record(subjectId: string, purposeKey: string, state: ConsentState, at?: Date): Promise<void> | void;
  latest(subjectId: string, purposeKey: string): Promise<ConsentRecord | undefined> | ConsentRecord | undefined;
}

export class ConsentDenied extends Error {
  constructor(public readonly subjectId: string, public readonly purposeKey: string) {
    super(`no active consent for subject ${subjectId} and purpose ${purposeKey}`);
    this.name = "ConsentDenied";
  }
}

export class UnknownPurpose extends Error {
  constructor(public readonly purposeKey: string) {
    super(`unknown processing purpose: ${purposeKey}`);
    this.name = "UnknownPurpose";
  }
}

/** In-memory purpose registry + consent store (adopters back the store with a DB). */
export class ConsentRegistry implements ConsentStore {
  private purposes = new Map<string, Purpose>();
  private records: ConsentRecord[] = [];

  constructor(purposes: Purpose[] = []) {
    for (const p of purposes) this.registerPurpose(p);
  }

  registerPurpose(p: Purpose): void { this.purposes.set(p.key, p); }
  getPurpose(key: string): Purpose | undefined { return this.purposes.get(key); }
  listPurposes(): Purpose[] { return [...this.purposes.values()]; }

  record(subjectId: string, purposeKey: string, state: ConsentState, at = new Date()): void {
    if (!this.purposes.has(purposeKey)) throw new UnknownPurpose(purposeKey);
    this.records.push({ subjectId, purposeKey, state, at });
  }

  latest(subjectId: string, purposeKey: string): ConsentRecord | undefined {
    // Insertion order breaks timestamp ties: the last-recorded decision wins even
    // when two decisions land in the same millisecond.
    let found: ConsentRecord | undefined;
    for (const r of this.records) {
      if (r.subjectId !== subjectId || r.purposeKey !== purposeKey) continue;
      if (!found || r.at.getTime() >= found.at.getTime()) found = r;
    }
    return found;
  }

  /** True when the subject currently permits processing for this purpose. */
  hasConsent(subjectId: string, purposeKey: string): boolean {
    const purpose = this.purposes.get(purposeKey);
    if (!purpose) throw new UnknownPurpose(purposeKey);
    if (purpose.legitimateUse) return true;
    return this.latest(subjectId, purposeKey)?.state === "granted";
  }

  /** Throws ConsentDenied when processing is not permitted. */
  assertConsent(subjectId: string, purposeKey: string): void {
    if (!this.hasConsent(subjectId, purposeKey)) throw new ConsentDenied(subjectId, purposeKey);
  }
}

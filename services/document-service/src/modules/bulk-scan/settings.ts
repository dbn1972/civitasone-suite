/**
 * Effective-settings resolution + settings-change helpers (pure parts). DB access lives in repo.ts.
 *
 * SAFE DEFAULTS (when a tenant never configured anything):
 *   provider chain   tesseract only (local, always available; no cloud egress of scans)
 *   languages        eng + hin           dpi 300           review threshold 0.80
 *   malware scanning FAIL-CLOSED ON      duplicate policy  skip
 *   limits           50 MB / file, 500 files / batch, 5 GB / batch
 *   link targets     all five ON         filing maker-checker ON
 *   concurrency      2 files per tenant at once, 5 attempts then dead-letter
 *   two-digit years  pivot 49 (<=49 => 20yy, else 19yy)
 *   PII              Aadhaar masked in stored text/index, everything else flagged
 */
import { settingsSchema, profileConfigSchema, type BulkScanSettings, type ProfileConfig } from "./validators.js";

export const DEFAULT_SETTINGS: BulkScanSettings = settingsSchema.parse({});

/** Merge a profile preset over tenant settings, re-validating the cross-field rules. */
export function applyProfile(base: BulkScanSettings, profile: ProfileConfig | null | undefined): BulkScanSettings {
  if (!profile) return base;
  const p = profileConfigSchema.parse(profile);
  const { defaultDocType: _d, linkDefaults: _l, classification: cls, ...overrides } = p;
  void _d; void _l;
  return settingsSchema.parse({ ...base, ...overrides, classification: { ...base.classification, ...(cls ?? {}) } });
}

/** Parse a stored settings document; falls back to safe defaults when it no longer validates. */
export function parseStoredSettings(raw: unknown): { settings: BulkScanSettings; degraded: boolean } {
  if (raw == null) return { settings: DEFAULT_SETTINGS, degraded: false };
  const r = settingsSchema.safeParse(raw);
  if (r.success) return { settings: r.data, degraded: false };
  return { settings: DEFAULT_SETTINGS, degraded: true };
}

/**
 * Needs a REASON from the maker when it weakens the malware gate (fail-closed ON -> OFF) or the filing maker-checker
 * (ON -> OFF). Sensitive changes need the second-approver policy: a super_admin must approve (enforced in the route,
 * re-checked in the consumer) and the maker must give a reason.
 */
export function isSensitiveChange(current: BulkScanSettings, proposed: BulkScanSettings): boolean {
  return (current.malwareFailClosed && !proposed.malwareFailClosed) || (current.filingMakerChecker && !proposed.filingMakerChecker);
}

/** Shallow list of top-level keys that differ - used for audit detail (no values, may be large). */
export function changedKeys(current: BulkScanSettings, proposed: BulkScanSettings): string[] {
  return (Object.keys(proposed) as (keyof BulkScanSettings)[]).filter(
    (k) => JSON.stringify(current[k]) !== JSON.stringify(proposed[k]),
  );
}

// GAP-ADMIN-CONFIG-01/03: build the PATCH body for admin-service's
// PATCH /v1/admin/platform-config from what the admin actually changed, and
// validate it against that route's own bounds before anything is sent.
// The route's zod schema is .strict(), so any field it does not know (the old
// form's platformName, supportEmail, maxLoginAttempts, ...) is a 400.

export type PlatformControllable = {
  cacheTtl: Record<string, number>;
  rateLimits: { perMinute: number; burstMax: number };
  logLevel: string;
  debugModeUntil: string | null;
  notifications: { emailProvider: string; smsProvider: string; emailFrom: string; smsFrom: string };
};

/** Editable form state: every number is kept as text so an emptied field is "empty", never 0. */
export type ConfigFormValues = {
  logLevel: string;
  perMinute: string;
  burstMax: string;
  cacheTtl: Record<string, string>;
  emailProvider: string;
  smsProvider: string;
  emailFrom: string;
  smsFrom: string;
};

export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export const CACHE_TTL_BOUNDS = { min: 5, max: 3600 } as const;
export const PER_MINUTE_MIN = 10;
export const BURST_MAX_MIN = 5;

export function toFormValues(c: PlatformControllable): ConfigFormValues {
  return {
    logLevel: c.logLevel,
    perMinute: String(c.rateLimits.perMinute),
    burstMax: String(c.rateLimits.burstMax),
    cacheTtl: Object.fromEntries(Object.entries(c.cacheTtl).map(([k, v]) => [k, String(v)])),
    emailProvider: c.notifications.emailProvider,
    smsProvider: c.notifications.smsProvider,
    emailFrom: c.notifications.emailFrom,
    smsFrom: c.notifications.smsFrom,
  };
}

export type ConfigPatch = {
  logLevel?: string;
  rateLimits?: { perMinute?: number; burstMax?: number };
  cacheTtl?: Record<string, number>;
  notifications?: Partial<PlatformControllable["notifications"]>;
};

export type ConfigErrors = Record<string, string>;

function parseInt10(text: string): number | null {
  return /^\d+$/.test(text.trim()) ? Number(text.trim()) : null;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Compares `current` against the values loaded from the server (`initial`) and
 * returns only the changed fields, or per-field errors. An empty patch means
 * "nothing changed".
 */
export function buildConfigPatch(
  initial: ConfigFormValues,
  current: ConfigFormValues,
): { ok: true; patch: ConfigPatch } | { ok: false; errors: ConfigErrors } {
  const errors: ConfigErrors = {};
  const patch: ConfigPatch = {};

  if (current.logLevel !== initial.logLevel) {
    if ((LOG_LEVELS as readonly string[]).includes(current.logLevel)) patch.logLevel = current.logLevel;
    else errors.logLevel = "Choose a log level";
  }

  const rate: NonNullable<ConfigPatch["rateLimits"]> = {};
  if (current.perMinute !== initial.perMinute) {
    const n = parseInt10(current.perMinute);
    if (n === null || n < PER_MINUTE_MIN) errors.perMinute = `Enter ${PER_MINUTE_MIN} or more`;
    else rate.perMinute = n;
  }
  if (current.burstMax !== initial.burstMax) {
    const n = parseInt10(current.burstMax);
    if (n === null || n < BURST_MAX_MIN) errors.burstMax = `Enter ${BURST_MAX_MIN} or more`;
    else rate.burstMax = n;
  }
  if (Object.keys(rate).length > 0) patch.rateLimits = rate;

  const ttl: Record<string, number> = {};
  for (const [mod, text] of Object.entries(current.cacheTtl)) {
    if (text === initial.cacheTtl[mod]) continue;
    const n = parseInt10(text);
    if (n === null || n < CACHE_TTL_BOUNDS.min || n > CACHE_TTL_BOUNDS.max) errors[`cacheTtl.${mod}`] = `Enter ${CACHE_TTL_BOUNDS.min}-${CACHE_TTL_BOUNDS.max}`;
    else ttl[mod] = n;
  }
  if (Object.keys(ttl).length > 0) patch.cacheTtl = ttl;

  const notif: NonNullable<ConfigPatch["notifications"]> = {};
  if (current.emailProvider !== initial.emailProvider) notif.emailProvider = current.emailProvider.trim();
  if (current.smsProvider !== initial.smsProvider) notif.smsProvider = current.smsProvider.trim();
  if (current.smsFrom !== initial.smsFrom) notif.smsFrom = current.smsFrom.trim();
  if (current.emailFrom !== initial.emailFrom) {
    if (!EMAIL.test(current.emailFrom.trim())) errors.emailFrom = "Enter a valid email address";
    else notif.emailFrom = current.emailFrom.trim();
  }
  if (Object.keys(notif).length > 0) patch.notifications = notif;

  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, patch };
}

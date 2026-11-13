/**
 * S8 G5 -- what happens when a contract lapses, and who hears about it. Pure helpers; the expiry and
 * auto-separate consumers apply them.
 *
 * lapse_action (tenant setting; owner question 7 is undecided, so the default is today's behaviour):
 *   auto_separate  an unrenewed lapse expires the contract and separates the employee (today).
 *   flag_only      never separates. HR is flagged on the lapse day and escalated once grace_days have passed
 *                  with no renewal; the contract stays in force until a person decides. Separating removes the
 *                  person from the next payroll feed, so this is the safer choice for a payroll-bearing tenant.
 */
export const LAPSE_ACTIONS = ["auto_separate", "flag_only"] as const;
export type LapseAction = (typeof LAPSE_ACTIONS)[number];

export const NOTIFY_ROLES = ["project_manager", "line_manager"] as const;
export type NotifyRole = (typeof NOTIFY_ROLES)[number];

/** Dedup markers in contracts.hrms_contract_notifications.milestone (real milestones are positive day counts). */
export const LAPSE_FLAGGED_MARK = 0;
export const GRACE_ELAPSED_MARK = -1;

export type LapsePolicy = { action: LapseAction; graceDays: number };

export function resolveLapsePolicy(config: { lapseAction?: unknown; graceDays?: unknown } | null | undefined): LapsePolicy {
  const action: LapseAction = config?.lapseAction === "flag_only" ? "flag_only" : "auto_separate";
  const g = Number(config?.graceDays);
  return { action, graceDays: Number.isInteger(g) && g >= 0 && g <= 365 ? g : 0 };
}

export function resolveNotifyRoles(config: { notifyRoles?: unknown } | null | undefined): NotifyRole[] {
  const raw = config?.notifyRoles;
  if (!Array.isArray(raw)) return [];
  return NOTIFY_ROLES.filter((r) => raw.includes(r));
}

/** Which flag_only markers are due for a contract whose end date was `daysPastEnd` days ago (0 = the end date itself is past today). */
export function flagOnlyDue(daysPastEnd: number, graceDays: number): number[] {
  if (daysPastEnd < 0) return [];
  const due = [LAPSE_FLAGGED_MARK];
  if (daysPastEnd >= graceDays) due.push(GRACE_ELAPSED_MARK);
  return due;
}

/** Recipient employee ids: the employee plus the configured managers (de-duplicated, nulls dropped). */
export function routeRecipients(
  employee: { managerId?: string | null; projectManagerId?: string | null } | null,
  employeeId: string,
  roles: readonly NotifyRole[],
): string[] {
  const out = new Set<string>([employeeId]);
  if (employee) {
    if (roles.includes("project_manager") && employee.projectManagerId) out.add(employee.projectManagerId);
    if (roles.includes("line_manager") && employee.managerId) out.add(employee.managerId);
  }
  return [...out];
}

export type DigestRow = { endDate: string; hasRenewalRequest: boolean };

/** Weekly HR digest numbers: contracts ending within windowDays of today, and how many have no renewal request. */
export function buildDigest(rows: readonly DigestRow[], today: string, windowDays = 30): { endingSoon: number; withoutRenewal: number } {
  const t = Date.parse(`${today}T00:00:00Z`);
  const limit = t + windowDays * 86_400_000;
  const inWindow = rows.filter((r) => {
    const e = Date.parse(`${r.endDate}T00:00:00Z`);
    return e >= t && e <= limit;
  });
  return { endingSoon: inWindow.length, withoutRenewal: inWindow.filter((r) => !r.hasRenewalRequest).length };
}

/** The digest goes out on Mondays (UTC date of the detection run). */
export function isDigestDay(today: string): boolean {
  return new Date(`${today}T00:00:00Z`).getUTCDay() === 1;
}

/**
 * Which result-lifecycle buttons to offer for one assessment attempt (GAP-RECRUITMENT-DETAIL-14). The service
 * re-checks every state and the maker-checker rules (a moderation approver cannot also freeze); these only avoid
 * inviting an action it is certain to refuse.
 */
export type AttemptRow = {
  id: string;
  applicationId: string | null;
  status: string;
  result: string;
  slotLabel: string | null;
  frozen: boolean;
  published: boolean;
};

export type ResultStep = "consolidate" | "freeze" | "publish";

export function resultActions(a: Pick<AttemptRow, "status" | "frozen" | "published">): ResultStep[] {
  if (a.published) return [];
  if (a.frozen) return ["publish"];
  if (a.status === "evaluated") return ["consolidate", "freeze"];
  return [];
}

/** Attempts of this vacancy's own applicants, in a stable order (by candidate name, then id). */
export function attemptsForVacancy(attempts: readonly AttemptRow[], names: ReadonlyMap<string, string>): Array<AttemptRow & { name: string }> {
  return attempts
    .filter((a): a is AttemptRow & { applicationId: string } => a.applicationId !== null && names.has(a.applicationId))
    .map((a) => ({ ...a, name: names.get(a.applicationId) as string }))
    .sort((x, y) => x.name.localeCompare(y.name) || x.id.localeCompare(y.id));
}

export type AdmitCard = {
  attemptId: string;
  rollNumber: string;
  candidateName: string;
  applicationNo: string | null;
  examination: string;
  mode: string;
  windowStart: string;
  windowEnd: string;
  slotLabel: string | null;
  identityVerified: boolean;
  instructions: string[];
};

/** True when none of the vacancy's applicants has an attempt in the chosen sitting (the page checks its load-failed flag first). */
export function hasNoAttempts(rows: readonly unknown[]): boolean {
  return rows.length === 0;
}

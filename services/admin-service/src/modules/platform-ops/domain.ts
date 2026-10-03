/**
 * Pure rules for the platform onboarding queue and for personal-data handling
 * on the platform-operator screens (GAP-ADMIN-ONBOARDING-05/-07,
 * GAP-ADMIN-OPERATORS-06).
 */

export const ONBOARDING_STAGES = [
  "new request", "in progress", "go-live pending", "completed", "rejected", "cancelled",
] as const;
export type OnboardingStage = (typeof ONBOARDING_STAGES)[number];

/** Stage machine. Terminal stages have no outgoing edge. */
const TRANSITIONS: Record<OnboardingStage, readonly OnboardingStage[]> = {
  "new request": ["in progress", "rejected", "cancelled"],
  "in progress": ["go-live pending", "rejected", "cancelled"],
  "go-live pending": ["completed", "in progress", "cancelled"],
  completed: [],
  rejected: [],
  cancelled: [],
};

export function canTransition(from: OnboardingStage, to: OnboardingStage): boolean {
  return TRANSITIONS[from].includes(to);
}

export function isTerminalStage(stage: OnboardingStage): boolean {
  return TRANSITIONS[stage].length === 0;
}

/** "jane.doe@dept.gov.in" -> "j***@dept.gov.in". A value with no "@" is masked in full. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 1) return email ? "***" : "";
  return `${email[0]}***${email.slice(at)}`;
}

/** "Jane Doe" -> "J*** D***": initials only, so a row stays recognisable to its owner without exposing the name. */
export function maskName(name: string): string {
  return name.split(/\s+/).filter(Boolean).map((w) => `${w[0]}***`).join(" ");
}

/** The single Contact cell: masked name and masked e-mail. Empty when the request carries no contact. */
export function maskedContact(name: string, email: string): string {
  return [maskName(name), maskEmail(email)].filter(Boolean).join(" · ");
}

/** Resources whose CSV export / PII reveal is recorded through the platform data-access audit. */
export const PLATFORM_AUDIT_RESOURCES = ["onboarding", "operators"] as const;
export type PlatformAuditResource = (typeof PLATFORM_AUDIT_RESOURCES)[number];

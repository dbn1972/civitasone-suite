/**
 * Candidate professional profile (pure) — skills/proficiency, certifications,
 * languages, and credentials (publications/patents/memberships/awards). R-RA-0086.
 * No I/O; `nowMs` passed in for date checks.
 */

export const PROFICIENCY_LEVELS = ["beginner", "intermediate", "advanced", "expert"] as const;
export const LANGUAGE_PROFICIENCY = ["basic", "conversational", "fluent", "native"] as const;
export const CREDENTIAL_KINDS = ["publication", "patent", "membership", "award"] as const;

const norm = (s: string | null | undefined) => (s || "").trim().toLowerCase();

export interface Skill { skill: string; proficiency: string; yearsExperience?: number | null }
export interface Certification { name: string; issuer: string; issueDate?: string | null; expiryDate?: string | null; credentialId?: string | null; credentialUrl?: string | null }
export interface Language { language: string; canRead?: boolean; canWrite?: boolean; canSpeak?: boolean; proficiency?: string | null }
export interface Credential { kind: string; title: string; detail?: string | null; year?: number | null; referenceUrl?: string | null }

export function validateSkills(skills: readonly Skill[]): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  skills.forEach((s, i) => {
    const label = s.skill?.trim() || `skill ${i + 1}`;
    if (!s.skill || s.skill.trim() === "") errors.push(`skill ${i + 1}: name is required`);
    if (!(PROFICIENCY_LEVELS as readonly string[]).includes(s.proficiency)) errors.push(`${label}: proficiency must be one of ${PROFICIENCY_LEVELS.join("/")}`);
    if (s.yearsExperience != null && (!Number.isFinite(s.yearsExperience) || s.yearsExperience < 0 || s.yearsExperience > 80)) errors.push(`${label}: years of experience is out of range`);
    const k = norm(s.skill);
    if (k) { if (seen.has(k)) errors.push(`${label}: duplicate skill`); else seen.add(k); }
  });
  return errors;
}

export function validateCertifications(certs: readonly Certification[], nowMs: number): string[] {
  const errors: string[] = [];
  certs.forEach((c, i) => {
    const label = c.name?.trim() || `certification ${i + 1}`;
    if (!c.name || c.name.trim() === "") errors.push(`certification ${i + 1}: name is required`);
    if (!c.issuer || c.issuer.trim() === "") errors.push(`${label}: issuer is required`);
    const issue = c.issueDate ? Date.parse(c.issueDate) : null;
    const expiry = c.expiryDate ? Date.parse(c.expiryDate) : null;
    if (c.issueDate && (issue == null || Number.isNaN(issue))) errors.push(`${label}: invalid issue date`);
    if (c.expiryDate && (expiry == null || Number.isNaN(expiry))) errors.push(`${label}: invalid expiry date`);
    if (issue != null && !Number.isNaN(issue) && issue > nowMs) errors.push(`${label}: issue date cannot be in the future`);
    if (issue != null && expiry != null && !Number.isNaN(issue) && !Number.isNaN(expiry) && expiry < issue) errors.push(`${label}: expiry date precedes issue date`);
  });
  return errors;
}

export function validateLanguages(langs: readonly Language[]): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  langs.forEach((l, i) => {
    const label = l.language?.trim() || `language ${i + 1}`;
    if (!l.language || l.language.trim() === "") errors.push(`language ${i + 1}: name is required`);
    if (!l.canRead && !l.canWrite && !l.canSpeak) errors.push(`${label}: at least one of read/write/speak is required`);
    if (l.proficiency != null && !(LANGUAGE_PROFICIENCY as readonly string[]).includes(l.proficiency)) errors.push(`${label}: invalid proficiency`);
    const k = norm(l.language);
    if (k) { if (seen.has(k)) errors.push(`${label}: duplicate language`); else seen.add(k); }
  });
  return errors;
}

export function validateCredentials(creds: readonly Credential[], nowMs: number): string[] {
  const errors: string[] = [];
  const thisYear = new Date(nowMs).getUTCFullYear();
  creds.forEach((c, i) => {
    const label = c.title?.trim() || `credential ${i + 1}`;
    if (!(CREDENTIAL_KINDS as readonly string[]).includes(c.kind)) errors.push(`credential ${i + 1}: kind must be one of ${CREDENTIAL_KINDS.join("/")}`);
    if (!c.title || c.title.trim() === "") errors.push(`credential ${i + 1}: title is required`);
    if (c.year != null && (!Number.isInteger(c.year) || c.year < 1900 || c.year > thisYear)) errors.push(`${label}: year must be between 1900 and ${thisYear}`);
  });
  return errors;
}

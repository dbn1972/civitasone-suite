import { eq, and } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import {
  hrmsCandidateSkills, hrmsCandidateCertifications, hrmsCandidateLanguages, hrmsCandidateCredentials,
  type SkillRow, type SkillInsert, type CertificationRow, type CertificationInsert,
  type LanguageRow, type LanguageInsert, type CredentialRow, type CredentialInsert,
} from "./skills-schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select" | "delete">;

// Each section is a full-replacement (delete-then-insert) scoped to the candidate.
async function replace<T>(tx: Writer, table: typeof hrmsCandidateSkills | typeof hrmsCandidateCertifications | typeof hrmsCandidateLanguages | typeof hrmsCandidateCredentials, tenantId: string, candidateId: string, rows: T[]): Promise<void> {
  await tx.delete(table).where(and(eq(table.tenantId, tenantId), eq(table.candidateId, candidateId)));
  if (rows.length > 0) await tx.insert(table).values(rows as never);
}

export const setSkills = (tx: Writer, t: string, c: string, rows: SkillInsert[]) => replace(tx, hrmsCandidateSkills, t, c, rows);
export const setCertifications = (tx: Writer, t: string, c: string, rows: CertificationInsert[]) => replace(tx, hrmsCandidateCertifications, t, c, rows);
export const setLanguages = (tx: Writer, t: string, c: string, rows: LanguageInsert[]) => replace(tx, hrmsCandidateLanguages, t, c, rows);
export const setCredentials = (tx: Writer, t: string, c: string, rows: CredentialInsert[]) => replace(tx, hrmsCandidateCredentials, t, c, rows);

export async function listSkills(t: string, c: string): Promise<SkillRow[]> {
  return scopedRead((tx) => tx.select().from(hrmsCandidateSkills).where(and(eq(hrmsCandidateSkills.tenantId, t), eq(hrmsCandidateSkills.candidateId, c))));
}
export async function listCertifications(t: string, c: string): Promise<CertificationRow[]> {
  return scopedRead((tx) => tx.select().from(hrmsCandidateCertifications).where(and(eq(hrmsCandidateCertifications.tenantId, t), eq(hrmsCandidateCertifications.candidateId, c))));
}
export async function listLanguages(t: string, c: string): Promise<LanguageRow[]> {
  return scopedRead((tx) => tx.select().from(hrmsCandidateLanguages).where(and(eq(hrmsCandidateLanguages.tenantId, t), eq(hrmsCandidateLanguages.candidateId, c))));
}
export async function listCredentials(t: string, c: string): Promise<CredentialRow[]> {
  return scopedRead((tx) => tx.select().from(hrmsCandidateCredentials).where(and(eq(hrmsCandidateCredentials.tenantId, t), eq(hrmsCandidateCredentials.candidateId, c))));
}

import { z } from "zod";

export const idParam = z.object({ id: z.string().uuid() });

/** A single party (petitioner / respondent / advocate-of-record etc.) attached to a case. */
export const casePartyBody = z.object({
  partyRole:     z.string().trim().min(1).max(32),
  name:          z.string().trim().min(1).max(200),
  address:       z.string().trim().max(500).optional(),
  phone:         z.string().trim().max(20).optional(),
  email:         z.string().trim().email().max(200).optional(),
  advocateName:  z.string().trim().max(200).optional(),
  advocateBarId: z.string().trim().max(64).optional(),
});
export type CasePartyBody = z.infer<typeof casePartyBody>;

export const registerCaseBody = z.object({
  cnrNumber:     z.string().trim().min(1).max(32),
  caseType:      z.string().trim().min(1).max(48),
  filingNumber:  z.string().trim().max(64).optional(),
  // ISO-8601 date (YYYY-MM-DD or full timestamp); coerced to Date in the consumer.
  filingDate:    z.string().trim().min(1).max(40),
  title:         z.string().trim().min(1).max(300),
  courtId:       z.string().uuid(),
  benchId:       z.string().uuid().optional(),
  parties:       z.array(casePartyBody).min(1).max(100),
});
export type RegisterCaseBody = z.infer<typeof registerCaseBody>;

export const listCasesQuery = z.object({
  status:  z.string().trim().max(24).optional(),
  courtId: z.string().uuid().optional(),
  limit:   z.coerce.number().int().min(1).max(100).default(20),
  offset:  z.coerce.number().int().min(0).default(0),
});
export type ListCasesQuery = z.infer<typeof listCasesQuery>;

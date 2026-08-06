/**
 * Zod request schemas for the programmes module (G12).
 *
 * Every route parses through here before anything is published — the queue payload is
 * built from the parsed value, never from `req.body`. `.strict()` on the bodies is
 * deliberate: a typo'd field name in a caller's integration should be a loud 400, not a
 * silently ignored value that leaves the programme configured differently from what the
 * caller believes.
 */
import { z } from "zod";
import { listQuery } from "../../shared/list-query.js";
import { METRIC_KINDS, PROGRAMME_CODE_PATTERN, PROGRAMME_STATUSES, normaliseProgrammeCode } from "./domain.js";

export const idParam = z.object({ id: z.string().uuid() });

export const programmeDealParam = z.object({
  id: z.string().uuid(),
  dealId: z.string().uuid(),
});

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be an ISO date (YYYY-MM-DD)");

/** Uppercased during parse so uniqueness is decided on the canonical form. */
const programmeCode = z
  .string()
  .min(3)
  .max(64)
  .transform(normaliseProgrammeCode)
  .refine((c) => PROGRAMME_CODE_PATTERN.test(c), {
    message: "programmeCode must be 3-64 chars of A-Z, 0-9, '-', '_' or '/'",
  });

const coverageList = z.array(z.string().min(1).max(120)).max(500);

const coverageScope = z
  .object({
    regions: coverageList.optional(),
    districts: coverageList.optional(),
  })
  .strict();

export const createProgrammeBody = z
  .object({
    programmeCode,
    name: z.string().min(1).max(200),
    description: z.string().max(4000).optional(),
    accountId: z.string().uuid(),
    contractId: z.string().uuid().optional(),
    productLine: z.string().min(1).max(64).optional(),
    startDate: isoDate.optional(),
    endDate: isoDate.optional(),
    sponsoringDepartment: z.string().min(1).max(200).optional(),
    coverageScope: coverageScope.optional(),
  })
  .strict();
export type CreateProgrammeBody = z.infer<typeof createProgrammeBody>;

/**
 * `version` is REQUIRED on update. The consumer's UPDATE is guarded on it, so accepting a
 * patch without one would mean answering 202 to a write that may be dropped.
 */
export const updateProgrammeBody = z
  .object({
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(4000).nullable().optional(),
    contractId: z.string().uuid().nullable().optional(),
    productLine: z.string().min(1).max(64).optional(),
    startDate: isoDate.nullable().optional(),
    endDate: isoDate.nullable().optional(),
    sponsoringDepartment: z.string().min(1).max(200).nullable().optional(),
    coverageScope: coverageScope.optional(),
    version: z.number().int().min(1),
  })
  .strict()
  .refine(
    (b) =>
      b.name !== undefined ||
      b.description !== undefined ||
      b.contractId !== undefined ||
      b.productLine !== undefined ||
      b.startDate !== undefined ||
      b.endDate !== undefined ||
      b.sponsoringDepartment !== undefined ||
      b.coverageScope !== undefined,
    { message: "at least one mutable field is required" },
  );
export type UpdateProgrammeBody = z.infer<typeof updateProgrammeBody>;

export const statusBody = z
  .object({
    status: z.enum(PROGRAMME_STATUSES),
    reason: z.string().max(2000).optional(),
    version: z.number().int().min(1),
  })
  .strict();
export type StatusBody = z.infer<typeof statusBody>;

/**
 * `value` is a STRING for every kind, monetary or not. A JSON number would round a
 * revenue figure above 2^53 minor units and would quietly re-scale a 6-dp ratio.
 */
export const recordMetricBody = z
  .object({
    periodStart: isoDate,
    periodEnd: isoDate,
    metricKey: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-z][a-z0-9_]*$/, "metricKey must be lower_snake_case"),
    metricKind: z.enum(METRIC_KINDS).optional(),
    value: z.string().min(1).max(32),
    currency: z.string().length(3).optional(),
  })
  .strict();
export type RecordMetricBody = z.infer<typeof recordMetricBody>;

export const linkDealBody = z
  .object({
    /** The deal's current version — the link UPDATE is guarded on it. */
    dealVersion: z.number().int().min(1),
  })
  .strict();
export type LinkDealBody = z.infer<typeof linkDealBody>;

export const programmeListQuery = listQuery.extend({
  status: z.enum(PROGRAMME_STATUSES).optional(),
  accountId: z.string().uuid().optional(),
  productLine: z.string().min(1).max(64).optional(),
});

export const metricListQuery = listQuery.extend({
  metricKey: z.string().min(1).max(64).optional(),
  periodStartFrom: isoDate.optional(),
  periodStartTo: isoDate.optional(),
});

export const healthQuery = z
  .object({
    periodStartFrom: isoDate.optional(),
    periodStartTo: isoDate.optional(),
  })
  .strict();

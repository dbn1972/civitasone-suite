import { z } from "zod";
import { bigintString } from "../../shared/validators.js";

const uuid = z.string().uuid();
const date = z.string().date();

const interestType = z.enum(["simple", "compound"]);
const roundingMode = z.enum(["floor", "ceil", "round_half_up"]);
const slabType = z.enum(["flat", "ad_valorem", "band"]);

/** Payload schema per `kind.action` — the server is the authority on what a proposal may contain. */
const PAYLOADS: Record<string, z.ZodTypeAny> = {
  "rate_head.create": z.object({
    code: z.string().min(1).max(32), name: z.string().min(1).max(100), category: z.string().min(1).max(48),
    unitOfMeasure: z.string().max(32).optional(),
  }),
  "rate_head.end_date": z.object({}),
  "rate_slab.create": z.object({
    rateHeadId: uuid, slabType, bandFrom: bigintString.optional(), bandTo: bigintString.optional(),
    rateValue: bigintString, effectiveTo: date.optional(),
  }),
  "rate_slab.revise": z.object({
    slabType: slabType.optional(), bandFrom: bigintString.nullable().optional(), bandTo: bigintString.nullable().optional(),
    rateValue: bigintString.optional(),
  }),
  "rate_slab.end_date": z.object({}),
  "penalty_rule.create": z.object({
    rateHeadId: uuid, interestType, annualRateBps: z.number().int().min(1).max(10000), graceDays: z.number().int().min(0).max(365),
    capMonths: z.number().int().min(1).max(120).optional(), roundingMode,
  }),
  "penalty_rule.revise": z.object({
    interestType: interestType.optional(), annualRateBps: z.number().int().min(1).max(10000).optional(),
    graceDays: z.number().int().min(0).max(365).optional(), capMonths: z.number().int().min(1).max(120).nullable().optional(),
    roundingMode: roundingMode.optional(),
  }),
  "penalty_rule.end_date": z.object({}),
  "rebate_rule.create": z.object({
    rateHeadId: uuid, rebateType: z.string().min(1).max(24), discountBps: z.number().int().min(1).max(10000),
    validUntilDaysBeforeDue: z.number().int().min(0).max(365),
  }),
  "rebate_rule.revise": z.object({
    rebateType: z.string().min(1).max(24).optional(), discountBps: z.number().int().min(1).max(10000).optional(),
    validUntilDaysBeforeDue: z.number().int().min(0).max(365).optional(),
  }),
  "rebate_rule.end_date": z.object({}),
};

/**
 * A rate-config proposal. `targetId` (the existing row) may be given at the top
 * level or inside `payload` and is required for revise / end_date; the payload
 * is validated against the schema for its kind + action and normalised.
 */
export const proposeBody = z
  .object({
    kind: z.enum(["rate_head", "rate_slab", "penalty_rule", "rebate_rule"]),
    action: z.enum(["create", "revise", "end_date"]),
    effectiveFrom: date,
    targetId: uuid.optional(),
    rateHeadId: uuid.optional(),
    payload: z.record(z.unknown()).default({}),
  })
  .transform((b, ctx) => {
    const { targetId: inner, ...rest } = b.payload as { targetId?: unknown } & Record<string, unknown>;
    const targetId = b.targetId ?? (typeof inner === "string" ? inner : undefined);
    const schema = PAYLOADS[`${b.kind}.${b.action}`];
    if (!schema) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `unsupported ${b.kind} ${b.action}`, path: ["action"] });
      return z.NEVER;
    }
    if (b.action !== "create" && !targetId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "targetId is required", path: ["targetId"] });
      return z.NEVER;
    }
    if (b.action !== "create" && targetId && !uuid.safeParse(targetId).success) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "targetId must be a uuid", path: ["targetId"] });
      return z.NEVER;
    }
    const parsed = schema.safeParse(rest);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) ctx.addIssue({ ...issue, path: ["payload", ...issue.path] });
      return z.NEVER;
    }
    if (b.action === "revise" && Object.keys(parsed.data as object).length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "a revision must change at least one field", path: ["payload"] });
      return z.NEVER;
    }
    return {
      kind: b.kind, action: b.action, effectiveFrom: b.effectiveFrom,
      targetId: b.action === "create" ? null : (targetId as string),
      rateHeadId: b.rateHeadId ?? (typeof (parsed.data as { rateHeadId?: unknown }).rateHeadId === "string" ? ((parsed.data as { rateHeadId: string }).rateHeadId) : null),
      payload: parsed.data as Record<string, unknown>,
    };
  });

export const decideBody = z.object({
  approve: z.boolean(),
  reason: z.string().max(500).optional(),
});

export const proposalListQuery = z.object({
  status: z.enum(["pending", "approved", "rejected"]).optional(),
  kind: z.enum(["rate_head", "rate_slab", "penalty_rule", "rebate_rule"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const previewQuery = z.object({
  /** Sample base value (paise) to compute the before/after demand on. Default 1,00,000.00 rupees. */
  baseValue: bigintString.default("10000000"),
});

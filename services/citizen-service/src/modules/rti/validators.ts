import { z } from "zod";
import { safeText } from "../../shared/sanitize.js";

export const idParam = z.object({ id: z.string().uuid() });

export const fileRtiBody = z.object({
  // P1-7: capped + sanitised free text.
  subject:     safeText({ max: 200 }),
  description: safeText({ max: 5000, multiline: true }),
  cpioRef:     z.string().uuid(),
  citizenId:   z.string().uuid().optional(),
});
export type FileRtiBody = z.infer<typeof fileRtiBody>;

export const respondRtiBody = z.object({
  // http(s) only: z.string().url() alone accepts javascript:/data:/file: which the web renders as a link.
  responseUrl: z.string().url().max(2048).refine((u) => /^https?:\/\//i.test(u), { message: "responseUrl must be an http(s) URL" }),
});
export type RespondRtiBody = z.infer<typeof respondRtiBody>;

export const appealRtiBody = z.object({
  appealType: z.enum(["first", "cic"]).default("first"),
  grounds:    safeText({ max: 5000, multiline: true }),
});
export type AppealRtiBody = z.infer<typeof appealRtiBody>;

export const RTI_APPEAL_OUTCOMES = ["allowed", "partly_allowed", "rejected", "remanded"] as const;
export type RtiAppealOutcome = typeof RTI_APPEAL_OUTCOMES[number];

/** Today's calendar date in Asia/Kolkata (UTC+05:30, no DST), YYYY-MM-DD. */
export function istToday(now: Date = new Date()): string {
  return new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD")
  .refine((s) => { const d = new Date(`${s}T00:00:00Z`); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s; }, "not a real calendar date");

/**
 * D2: first-appeal decision recorded by the appellate authority (rti_appellate).
 * decisionDate may not be in the future; hearingDate (optional) may not be after it.
 */
export const decideRtiAppealBody = z.object({
  outcome:      z.enum(RTI_APPEAL_OUTCOMES),
  decisionDate: isoDay,
  hearingDate:  isoDay.optional(),
  reason:       safeText({ max: 5000, multiline: true }),
}).superRefine((b, ctx) => {
  if (b.decisionDate > istToday()) {
    ctx.addIssue({ code: "custom", path: ["decisionDate"], message: "decisionDate cannot be in the future" });
  }
  if (b.hearingDate && b.hearingDate > b.decisionDate) {
    ctx.addIssue({ code: "custom", path: ["hearingDate"], message: "hearingDate cannot be after decisionDate" });
  }
});
export type DecideRtiAppealBody = z.infer<typeof decideRtiAppealBody>;

export const rtiAppealParams = z.object({ id: z.string().uuid(), appealId: z.string().uuid() });

export const transferRtiBody = z.object({
  // Shape + directory membership are checked in the route (422), not here (400).
  toAuthority: z.string().min(1).max(200),
});
export type TransferRtiBody = z.infer<typeof transferRtiBody>;

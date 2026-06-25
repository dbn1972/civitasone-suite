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
  responseUrl: z.string().url().max(2048),
});
export type RespondRtiBody = z.infer<typeof respondRtiBody>;

export const appealRtiBody = z.object({
  appealType: z.enum(["first", "cic"]).default("first"),
  grounds:    safeText({ max: 5000, multiline: true }),
});
export type AppealRtiBody = z.infer<typeof appealRtiBody>;

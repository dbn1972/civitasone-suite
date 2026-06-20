import { z } from "zod";

export const idParam = z.object({ id: z.string().uuid() });

export const fileRtiBody = z.object({
  subject:     z.string().min(1),
  description: z.string().min(1),
  cpioRef:     z.string().uuid(),
  citizenId:   z.string().uuid().optional(),
});
export type FileRtiBody = z.infer<typeof fileRtiBody>;

export const respondRtiBody = z.object({
  responseUrl: z.string().url(),
});
export type RespondRtiBody = z.infer<typeof respondRtiBody>;

export const appealRtiBody = z.object({
  appealType: z.enum(["first", "cic"]).default("first"),
  grounds:    z.string().min(1),
});
export type AppealRtiBody = z.infer<typeof appealRtiBody>;

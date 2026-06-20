import { z } from "zod";

const ucItemSchema = z.object({
  componentId:       z.string().uuid(),
  releasedMinor:     z.number().int().nonnegative(),
  expenditureMinor:  z.number().int().nonnegative(),
});

export const submitUcBody = z.object({
  ucNo:              z.string().min(1).max(64),
  periodFrom:        z.string().min(1),
  periodTo:          z.string().min(1),
  releasedMinor:     z.number().int().nonnegative(),
  expenditureMinor:  z.number().int().nonnegative(),
  items:             z.array(ucItemSchema).min(1),
});
export type SubmitUcBody = z.infer<typeof submitUcBody>;

export const schemeIdParam = z.object({ id: z.string().uuid() });

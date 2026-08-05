/**
 * CH-04 — zod validators for template-preview and variable validation.
 */
import { z } from "zod";

export const templatePreviewBody = z.object({
  templateId: z.string().uuid(),
  contactId: z.string().uuid(),
  variables: z.record(z.string(), z.string()).optional(),
});
export type TemplatePreviewBody = z.infer<typeof templatePreviewBody>;

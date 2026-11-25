import { z } from "zod";
import { SOURCE_REF_TYPES } from "@civitasone/eoffice-sdk";

/** Source ref types that any module can use to raise an eFile for approval. */
export { SOURCE_REF_TYPES };

export const fileFromModuleBody = z.object({
  refType:        z.enum(SOURCE_REF_TYPES),
  refId:          z.string().uuid(),
  subject:        z.string().min(3).max(500),
  dept:           z.string().min(1),
  // D12 (owner-approved default Ordinary): was "confidential", which with the D14 gate would hide every
  // module-raised approval file from its own approvers. Confidential+ must now be asked for explicitly.
  classification: z.enum(["top_secret", "secret", "confidential", "restricted", "public"]).default("public"),
  priority:       z.enum(["normal", "urgent", "immediate"]).default("normal"),
  // Optional: the server derives the initiator from the authenticated session. A supplied value
  // is only accepted when it equals the caller's own employee id (no raising in another officer's name).
  initiatedBy:    z.string().uuid().optional(),
  currentWith:    z.string().uuid(),                 // first officer in the chain
  approvalChain:  z.string().min(1),                 // workflow definition code
  initialNote:    z.string().min(1),                 // the proposal/justification note
  context:        z.record(z.unknown()).optional(),  // amount, HoA, etc.
});
export type FileFromModuleBody = z.infer<typeof fileFromModuleBody>;

export const refQuery = z.object({
  refType: z.enum(SOURCE_REF_TYPES),
  refId:   z.string().uuid(),
});

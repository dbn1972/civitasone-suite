/** zod validators for settings commands. */
import { z } from "zod";

export const settingUpsertBody = z.object({
  key: z.string().min(1).max(128).regex(/^[a-z][a-z0-9_.]*$/, "lowercase dot-notation key"),
  value: z.unknown(),
});
export type SettingUpsertBody = z.infer<typeof settingUpsertBody>;

export const settingDeleteBody = z.object({
  key: z.string().min(1).max(128),
});
export type SettingDeleteBody = z.infer<typeof settingDeleteBody>;

export const tenantIdParam = z.object({ tenantId: z.string().uuid() });
export const settingKeyParam = z.object({ key: z.string().min(1).max(128) });

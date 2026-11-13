import { z } from "zod";
import {
  NAMESPACE_PATTERN, KEY_PATTERN, COMMITTEE_POLICY_NS, AGENDA_NOTICE_KEY, AGENDA_NOTICE_MIN_DAYS, AGENDA_NOTICE_MAX_DAYS,
  committeeIdFromAgendaNoticeKey, parseAgendaNoticeDays,
} from "./domain.js";

export const configIdParam = z.object({ id: z.string().uuid() });
// UAT W8-B: namespace / key are validated HERE (zod -> 400). They used to be checked only by the
// domain assertValidNamespace/assertValidKey, which throw a plain Error, so any bad path segment 500d.
export const namespaceParam = z.object({ namespace: z.string().regex(NAMESPACE_PATTERN, "invalid namespace") });
export const configEntryQuery = z.object({
  namespace: z.string().regex(NAMESPACE_PATTERN, "invalid namespace"),
  key:       z.string().regex(KEY_PATTERN, "invalid key"),
});

/**
 * Set (create or version-guarded update) a config entry. `value` is arbitrary
 * JSON but MUST be present (a config entry always carries a value).
 * `expectedVersion` absent = create/first write; present = optimistic-lock guard
 * on an update. Mirrors court/visitor.
 */
export const setConfigBody = z.object({
  namespace:       z.string().trim().regex(NAMESPACE_PATTERN, "invalid namespace"),
  configKey:       z.string().trim().regex(KEY_PATTERN, "invalid configKey"),
  value:           z.any().refine((v) => v !== undefined, { message: "value is required" }),
  label:           z.string().trim().max(200).optional(),
  description:     z.string().trim().max(2000).optional(),
  sortOrder:       z.coerce.number().int().optional(),
  effectiveFrom:   z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "effectiveFrom must be YYYY-MM-DD").optional(),
  effectiveTo:     z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "effectiveTo must be YYYY-MM-DD").optional(),
  expectedVersion: z.coerce.number().int().min(1).optional(),
}).superRefine((b, ctx) => {
  // The agenda notice period is validated on write: a bad value used to be silently ignored at read time.
  const tenantLevel = b.namespace === "meeting_policy" && b.configKey === AGENDA_NOTICE_KEY;
  const committeeLevel = b.namespace === COMMITTEE_POLICY_NS;
  if (committeeLevel && committeeIdFromAgendaNoticeKey(b.configKey) === null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["configKey"], message: `${COMMITTEE_POLICY_NS} keys must be "${AGENDA_NOTICE_KEY}.<committeeId>"` });
  }
  if ((tenantLevel || committeeLevel) && parseAgendaNoticeDays(b.value) === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["value"], message: `value must be a whole number of days between ${AGENDA_NOTICE_MIN_DAYS} and ${AGENDA_NOTICE_MAX_DAYS}` });
  }
});
export type SetConfigBody = z.infer<typeof setConfigBody>;

/** Deactivate (soft-retire) a config entry. `expectedVersion` optimistic lock. */
export const deactivateConfigBody = z.object({
  expectedVersion: z.coerce.number().int().min(1),
});
export type DeactivateConfigBody = z.infer<typeof deactivateConfigBody>;

import { z } from "zod";

/**
 * GAP-WORKFLOW-INSTANCES-DETAIL-01 / GAP-PROJECTS-DETAIL-MEMBERS-01 (shared
 * user-directory capability).
 *
 * A minimal, non-PII directory lookup usable by ANY authenticated member of
 * the SAME tenant (not admin-gated — unlike GET /identity/users, which exposes
 * email + status and is restricted to tenant/platform admins). It answers two
 * read-only questions, tenant-scoped, returning ONLY {id, displayName}:
 *
 *   • `ids=` — resolve a known set of ids to display names (batch join for a
 *     workflow history/task table, a project member register, etc.). Capped at
 *     200 ids per request so a single call can never fan out unbounded.
 *   • `q=`   — type-ahead search by name / email / employee code (min 2 chars
 *     so a one-letter query can't enumerate the whole tenant), capped at 20
 *     rows. Email/empCode are matched on but NEVER returned.
 *
 * Exactly one of `ids` / `q` must be supplied.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const DIRECTORY_MAX_IDS = 200;
export const DIRECTORY_MAX_LIMIT = 20;

export const directoryQuery = z
  .object({
    // Comma-separated id list -> array of up to 200 unique UUIDs.
    ids: z
      .string()
      .trim()
      .transform((s) => s.split(",").map((x) => x.trim()).filter((x) => x.length > 0))
      .pipe(
        z
          .array(z.string().regex(UUID_RE, "each id must be a UUID"))
          .min(1, "ids must contain at least one id")
          .max(DIRECTORY_MAX_IDS, `ids may contain at most ${DIRECTORY_MAX_IDS} ids`),
      )
      .optional(),
    q: z.string().trim().min(2, "q must be at least 2 characters").max(100).optional(),
    limit: z.coerce.number().int().min(1).max(DIRECTORY_MAX_LIMIT).default(DIRECTORY_MAX_LIMIT),
  })
  .refine((v) => (v.ids === undefined) !== (v.q === undefined), {
    message: "provide exactly one of ids or q",
  });

export type DirectoryQuery = z.infer<typeof directoryQuery>;

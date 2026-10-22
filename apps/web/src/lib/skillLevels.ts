/**
 * GAP-HR-SKILLS-03: the skill proficiency scale shared by the Skill Matrix
 * page and its tests.
 *
 * The backend stores `assessed_level` as one of beginner / intermediate /
 * advanced / expert (POST /v1/hrms/skills/assessments constrains it with a
 * z.enum in gap-features/routes.ts), so they map 1:1 onto levels 1-4. The
 * older synonyms the same column could historically hold (basic, developing,
 * proficient) are kept so legacy rows still land on a sensible level. The
 * previous map sent both advanced and expert to 4, which left level 3
 * permanently unreachable.
 */
export type SkillLevel = 0 | 1 | 2 | 3 | 4; // 0 = not assessed, 1 = Beginner ... 4 = Expert

const LEVEL_MAP: Record<string, SkillLevel> = {
  expert: 4,
  advanced: 3,
  proficient: 3, // legacy synonym
  intermediate: 2,
  developing: 2, // legacy synonym
  beginner: 1,
  basic: 1, // legacy synonym
};

/** Maps a stored proficiency string to its 0-4 level (0 = unknown / not assessed). */
export function toLevel(proficiency: string | null | undefined): SkillLevel {
  return LEVEL_MAP[(proficiency ?? "").trim().toLowerCase()] ?? 0;
}

/**
 * The single baseline every skill is measured against on the matrix. It is
 * NOT a per-role requirement: no API returns a role -> required-level map per
 * employee yet (POST /v1/hrms/skills/role-matrix is write-only), so the page
 * says so in its legend ("Baseline for all skills: Advanced") instead of
 * implying a requirement that does not exist.
 */
export const SKILL_BASELINE_LEVEL: SkillLevel = 3;

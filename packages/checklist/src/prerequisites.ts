/**
 * Section prerequisite evaluation.
 *
 * A section with a prerequisite unlocks only when the named section has scored at
 * least `minScore`. Prerequisites CHAIN: if A gates B and B gates C, C stays locked
 * while A is unmet, even if B's own score happens to satisfy C's threshold. Resolving
 * that requires a fixpoint pass rather than a single lookup.
 *
 * Two degenerate structures are treated as permanently locked rather than as errors,
 * because instances hold a frozen copy of a structure that may predate today's
 * validation rules and a read of an old instance must not throw:
 *  - a prerequisite naming a section that does not exist;
 *  - a prerequisite cycle (A→B→A). Nothing in the cycle can ever be shown to have
 *    legitimately unlocked, so nothing in it does.
 * `validateStructure` rejects both at authoring time, which is where an author can
 * still fix them.
 */
import type { AvailabilityMap, ChecklistSection, SectionPrerequisite, SectionScores } from "./types.js";

/** True when the prerequisite section has scored at least the required minimum. */
export function isPrerequisiteSatisfied(
  prerequisite: SectionPrerequisite,
  sectionScores: SectionScores,
): boolean {
  const score = sectionScores[prerequisite.sectionId];
  if (score === undefined) return false;
  return score >= prerequisite.minScore;
}

/**
 * sectionId → availability, resolving chains by fixpoint. Sections whose availability
 * cannot be established (missing target, or a cycle) settle as `false`.
 */
export function resolveSectionAvailability(
  sections: readonly ChecklistSection[],
  sectionScores: SectionScores,
): AvailabilityMap {
  const available: AvailabilityMap = {};
  const pending = new Map<string, SectionPrerequisite>();

  for (const section of sections) {
    if (section.prerequisite === undefined) available[section.id] = true;
    else pending.set(section.id, section.prerequisite);
  }

  let progressed = true;
  while (progressed && pending.size > 0) {
    progressed = false;
    for (const [sectionId, prerequisite] of [...pending]) {
      const parentAvailable = available[prerequisite.sectionId];
      // Undecided parent: revisit on the next pass.
      if (parentAvailable === undefined) continue;
      available[sectionId] =
        parentAvailable && isPrerequisiteSatisfied(prerequisite, sectionScores);
      pending.delete(sectionId);
      progressed = true;
    }
  }

  // Whatever is left is unreachable (cycle or dangling reference): locked.
  for (const sectionId of pending.keys()) available[sectionId] = false;
  return available;
}

/** Ids of the sections a respondent may currently work on, in author order. */
export function availableSectionIds(
  sections: readonly ChecklistSection[],
  sectionScores: SectionScores,
): string[] {
  const availability = resolveSectionAvailability(sections, sectionScores);
  return sections.filter((s) => availability[s.id] === true).map((s) => s.id);
}

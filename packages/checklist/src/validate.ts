/**
 * Structural validation, run at AUTHORING time (before a template is stored or
 * published) rather than at read time.
 *
 * The split is deliberate: an instance carries a frozen copy of whatever structure
 * was published, possibly years ago and possibly predating a rule added since.
 * Reading such an instance must never throw, so the runtime functions degrade
 * (an unresolvable prerequisite locks its section) while these checks reject the
 * same shapes at the only point an author can still fix them.
 */
import { ChecklistDomainError } from "./errors.js";
import type { ChecklistSection } from "./types.js";

/** Every question id must be unique across the WHOLE template, not per section. */
export function validateUniqueQuestionIds(sections: readonly ChecklistSection[]): true {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const section of sections) {
    for (const question of section.questions) {
      if (seen.has(question.id)) duplicates.add(question.id);
      seen.add(question.id);
    }
  }
  if (duplicates.size > 0) {
    throw new ChecklistDomainError(
      "DUPLICATE_QUESTION_IDS",
      `duplicate question ids: ${[...duplicates].sort().join(", ")}`,
    );
  }
  return true;
}

export function validateUniqueSectionIds(sections: readonly ChecklistSection[]): true {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const section of sections) {
    if (seen.has(section.id)) duplicates.add(section.id);
    seen.add(section.id);
  }
  if (duplicates.size > 0) {
    throw new ChecklistDomainError(
      "DUPLICATE_SECTION_IDS",
      `duplicate section ids: ${[...duplicates].sort().join(", ")}`,
    );
  }
  return true;
}

/** A conditional rule may only depend on a question that exists in the template. */
export function validateConditionalReferences(sections: readonly ChecklistSection[]): true {
  const known = new Set(sections.flatMap((s) => s.questions.map((q) => q.id)));
  const dangling: string[] = [];
  for (const section of sections) {
    for (const question of section.questions) {
      for (const rule of question.conditionalLogic ?? []) {
        if (!known.has(rule.dependsOn)) dangling.push(`${question.id}→${rule.dependsOn}`);
        if ((rule.operator === "in" || rule.operator === "not_in") && !Array.isArray(rule.value)) {
          throw new ChecklistDomainError(
            "INVALID_CONDITION_VALUE",
            `question '${question.id}' uses '${rule.operator}' with a non-array value`,
          );
        }
        if (rule.dependsOn === question.id) {
          throw new ChecklistDomainError(
            "SELF_REFERENTIAL_CONDITION",
            `question '${question.id}' cannot depend on its own answer`,
          );
        }
      }
    }
  }
  if (dangling.length > 0) {
    throw new ChecklistDomainError(
      "UNKNOWN_CONDITION_DEPENDENCY",
      `conditional rules reference unknown questions: ${dangling.sort().join(", ")}`,
    );
  }
  return true;
}

/** Prerequisites must name a real section, must not self-reference, and must not cycle. */
export function validatePrerequisites(sections: readonly ChecklistSection[]): true {
  const byId = new Map(sections.map((s) => [s.id, s]));
  for (const section of sections) {
    const prerequisite = section.prerequisite;
    if (prerequisite === undefined) continue;
    if (prerequisite.sectionId === section.id) {
      throw new ChecklistDomainError(
        "SELF_REFERENTIAL_PREREQUISITE",
        `section '${section.id}' cannot be its own prerequisite`,
      );
    }
    if (!byId.has(prerequisite.sectionId)) {
      throw new ChecklistDomainError(
        "UNKNOWN_PREREQUISITE",
        `section '${section.id}' requires unknown section '${prerequisite.sectionId}'`,
      );
    }
  }

  // Walk each chain to its end; revisiting a section on the same walk is a cycle.
  for (const section of sections) {
    const seen = new Set<string>([section.id]);
    let cursor = byId.get(section.id)?.prerequisite?.sectionId;
    while (cursor !== undefined) {
      if (seen.has(cursor)) {
        throw new ChecklistDomainError(
          "PREREQUISITE_CYCLE",
          `prerequisite cycle involving section '${cursor}'`,
        );
      }
      seen.add(cursor);
      cursor = byId.get(cursor)?.prerequisite?.sectionId;
    }
  }
  return true;
}

/** Weights and thresholds must be finite and non-negative; scores are 0–100. */
export function validateWeights(sections: readonly ChecklistSection[]): true {
  for (const section of sections) {
    if (!Number.isFinite(section.weight) || section.weight < 0) {
      throw new ChecklistDomainError(
        "INVALID_SECTION_WEIGHT",
        `section '${section.id}' has a negative or non-finite weight`,
      );
    }
    const minScore = section.prerequisite?.minScore;
    if (minScore !== undefined && (!Number.isFinite(minScore) || minScore < 0 || minScore > 100)) {
      throw new ChecklistDomainError(
        "INVALID_PREREQUISITE_SCORE",
        `section '${section.id}' has a prerequisite minScore outside 0–100`,
      );
    }
    for (const question of section.questions) {
      if (!Number.isFinite(question.weight) || question.weight < 0) {
        throw new ChecklistDomainError(
          "INVALID_QUESTION_WEIGHT",
          `question '${question.id}' has a negative or non-finite weight`,
        );
      }
    }
  }
  return true;
}

/** Every authoring-time check, in one call. Throws on the first violation found. */
export function validateStructure(sections: readonly ChecklistSection[]): true {
  validateUniqueSectionIds(sections);
  validateUniqueQuestionIds(sections);
  validateWeights(sections);
  validateConditionalReferences(sections);
  validatePrerequisites(sections);
  return true;
}

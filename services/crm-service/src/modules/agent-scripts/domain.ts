/**
 * G14 — Agent Script domain logic.
 *
 * Pure functions: no I/O, no side effects. Used by consumer and tested in isolation.
 */

import type { AgentScriptView } from "./schema.js";

export type ScriptStatus = "draft" | "published" | "deprecated";

/**
 * Resolve the best script for a product+language combination.
 *
 * Strategy:
 * 1. Find the latest published script matching exact product+language.
 * 2. If no exact language match, fall back to 'en'.
 * 3. Return null if nothing found.
 *
 * "Latest" means the highest version_number among published scripts.
 */
export function resolveScript(
  productCode: string,
  language: string,
  scripts: AgentScriptView[],
): AgentScriptView | null {
  const published = scripts.filter((s) => s.status === "published");
  if (published.length === 0) return null;

  // Exact language match — pick the highest version_number.
  const exactMatch = published
    .filter((s) => s.productCode === productCode && s.language === language)
    .sort((a, b) => b.versionNumber - a.versionNumber);

  if (exactMatch.length > 0) return exactMatch[0]!;

  // Fallback to English.
  if (language !== "en") {
    const fallback = published
      .filter((s) => s.productCode === productCode && s.language === "en")
      .sort((a, b) => b.versionNumber - a.versionNumber);

    if (fallback.length > 0) return fallback[0]!;
  }

  return null;
}

/**
 * Only draft scripts can be published.
 */
export function canPublish(script: { status: string }): boolean {
  return script.status === "draft";
}

/**
 * Only published scripts can be deprecated.
 */
export function canDeprecate(script: { status: string }): boolean {
  return script.status === "published";
}

/**
 * DLT (TRAI) template pattern matching.
 *
 * DLT templates use {#var#} as variable placeholders. This function checks
 * whether a message body matches the DLT-registered template pattern by
 * splitting on {#var#} boundaries and verifying all literal parts appear
 * in sequence with at least one character between them.
 */

/**
 * Escapes regex special characters in a literal string.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Validates that a message body conforms to a DLT-registered template pattern.
 *
 * The approach: split the pattern on {#var#} placeholders. Each variable must
 * correspond to at least one character. We build a regex where each literal part
 * is anchored and variables are matched with (.+?) in a way that properly
 * constrains boundaries.
 *
 * @param messageBody - The actual message text to validate.
 * @param registeredPattern - The DLT template pattern with {#var#} placeholders.
 * @returns true if the message matches the pattern, false otherwise.
 */
export function validateDltTemplate(messageBody: string, registeredPattern: string): boolean {
  // Split pattern on {#var#} placeholder boundaries
  const parts = registeredPattern.split(/\{#var#\}/);

  // No variables — exact match required
  if (parts.length === 1) {
    return messageBody === registeredPattern;
  }

  // Sequential matching: verify all literal parts appear in order with
  // at least one character between consecutive parts.
  let pos = 0;

  for (let i = 0; i < parts.length; i++) {
    const literal = parts[i]!;

    if (i === 0) {
      // First part must be at the start
      if (!messageBody.startsWith(literal)) return false;
      pos = literal.length;
    } else {
      // There must be at least one character for the variable
      if (pos >= messageBody.length) return false;

      if (literal === "") {
        // Trailing variable (pattern ends with {#var#}) — just need chars remaining
        if (i === parts.length - 1) {
          // Last part is empty means pattern ends with {#var#}
          // Variable must consume at least 1 char
          return pos < messageBody.length;
        }
        // Middle empty part means consecutive {#var#}{#var#} — skip
        continue;
      }

      // Find the literal AFTER at least one character
      const searchFrom = pos + 1;
      const idx = messageBody.indexOf(literal, searchFrom);
      if (idx === -1) return false;
      pos = idx + literal.length;
    }
  }

  // After processing all parts, we must be at the end of the message
  // UNLESS the last part was empty (pattern ended with {#var#})
  const lastPart = parts[parts.length - 1]!;
  if (lastPart === "") {
    // Pattern ends with {#var#} — variable must have consumed at least 1 char
    // Already checked above
    return true;
  }

  return pos === messageBody.length;
}


/**
 * G8 domain function — validate DLT registration for a tenant + template + channel.
 * Pure lookup, cached via cache.getOrLoad. Returns the active DltTemplate if found,
 * or null if unregistered / expired / suspended.
 */
import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import type { DltTemplateRow } from "./schema.js";

export async function validateDltRegistration(
  tenantId: string,
  templateId: string,
  channel: string,
): Promise<DltTemplateRow | null> {
  // Skip DLT for non-regulated channels
  if (channel !== "sms" && channel !== "whatsapp") return null;

  const cacheKey = cache.makeKey(tenantId, "dlt_template", `${templateId}:${channel}`);
  const row = await cache.getOrLoad<DltTemplateRow | null>(cacheKey, async () => {
    const templates = await repo.findActiveByChannel(tenantId, channel);
    return templates.find((t) => t.templateId === templateId) ?? null;
  });

  if (!row) return null;
  // Check expiry
  if (row.expiresAt && new Date(row.expiresAt) < new Date()) return null;
  return row;
}

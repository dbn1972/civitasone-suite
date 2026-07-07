/**
 * Startup environment validation.
 *
 * Fail-fast checks run before any Fastify or DB initialization.
 * Each check returns an error message or null if valid.
 */

/**
 * Validates PII_ENC_KEY environment variable.
 * Returns an error message if invalid, null if valid.
 *
 * Requirements: 2.6
 */
export function validatePiiEncKey(value: string | undefined): string | null {
  if (!value || value.length < 16) {
    return (
      "PII_ENC_KEY is required and must be at least 16 characters. " +
      "Service cannot start without a valid encryption key configuration."
    );
  }
  return null;
}

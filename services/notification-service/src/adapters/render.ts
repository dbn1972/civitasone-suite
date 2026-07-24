/** Replace `{{key}}` placeholders in template bodies. */
export function renderBody(body: string, variables?: Record<string, string>): string {
  if (!variables) return body;
  return body.replace(/\{\{(\w+)\}\}/g, (_, key: string) => variables[key] ?? `{{${key}}}`);
}

// ─── MJML Compilation ──────────────────────────────────────────────────────────

import { pino } from "pino";

const log = pino({ name: "notification:render" });
const MAX_HTML_SIZE = 102400; // 100KB warning threshold

export type MjmlResult =
  | { ok: true; html: string }
  | { ok: false; errors: Array<{ message: string; line?: number | undefined }> };

export type Partial = { name: string; body: string };

/**
 * Resolve `{{> partialName}}` references in an MJML source by inlining partial bodies.
 * Supports up to 5 levels of nesting to prevent infinite recursion.
 */
export function resolvePartials(source: string, partials: Partial[], maxDepth = 5): string {
  let resolved = source;
  for (let depth = 0; depth < maxDepth; depth++) {
    const before = resolved;
    resolved = resolved.replace(/\{\{>\s*(\w+)\s*\}\}/g, (_, name: string) => {
      const partial = partials.find((p) => p.name === name);
      return partial?.body ?? `<!-- partial "${name}" not found -->`;
    });
    if (resolved === before) break; // No more partials to resolve
  }
  return resolved;
}

/**
 * Compile MJML source to responsive HTML email.
 * Returns structured errors if compilation fails.
 */
export async function compileMjml(source: string): Promise<MjmlResult> {
  try {
    // Dynamic import — mjml is an optional dependency
    const { default: mjml2html } = await import("mjml");
    const result = await mjml2html(source, {
      validationLevel: "soft",
      minify: false,
    });

    if (result.errors && result.errors.length > 0) {
      return {
        ok: false,
        errors: result.errors.map((e: { message: string; line?: number }) => ({
          message: e.message,
          line: e.line,
        })),
      };
    }

    const html = result.html;

    if (html.length > MAX_HTML_SIZE) {
      log.warn({ size: html.length, threshold: MAX_HTML_SIZE }, "compiled HTML exceeds size threshold");
    }

    return { ok: true, html };
  } catch (err) {
    return {
      ok: false,
      errors: [{ message: `MJML compilation failed: ${(err as Error).message}` }],
    };
  }
}

/**
 * Full render pipeline for MJML templates:
 * 1. Resolve partials
 * 2. Interpolate variables
 * 3. Compile MJML → HTML
 * 4. Inject header/footer if provided
 */
export async function renderMjmlTemplate(
  source: string,
  variables: Record<string, string>,
  partials: Partial[],
  options?: { header?: string | undefined; footer?: string | undefined },
): Promise<MjmlResult> {
  // Step 1: Resolve partials
  let resolved = resolvePartials(source, partials);

  // Step 2: Interpolate variables
  resolved = renderBody(resolved, variables);

  // Step 3: Compile MJML
  const result = await compileMjml(resolved);
  if (!result.ok) return result;

  // Step 4: Inject header/footer
  let html = result.html;
  if (options?.header) {
    html = html.replace(/<body[^>]*>/i, (match) => `${match}${options.header}`);
  }
  if (options?.footer) {
    html = html.replace(/<\/body>/i, `${options.footer}</body>`);
  }

  return { ok: true, html };
}

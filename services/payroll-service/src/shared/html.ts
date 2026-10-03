/**
 * HTML escaping for server-rendered documents (salary slips, Form 16).
 * Every value that is not a literal of ours -- names, departments, bank/PAN
 * strings, component names, a tenant's slip template footer -- is
 * attacker-influenceable text and must pass through escapeHtml before it is
 * interpolated into markup (stored XSS otherwise).
 */
export function escapeHtml(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * `{{key}}` substitution. Every variable is HTML-escaped EXCEPT the keys in
 * `rawKeys`, which must hold markup this module built itself from already
 * escaped parts (the row builders). Escaping happens in exactly one place per
 * value, so nothing is escaped twice.
 */
export function renderTemplate(template: string, vars: Record<string, string>, rawKeys: readonly string[] = []): string {
  const raw = new Set(rawKeys);
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const v = vars[key] ?? "";
    return raw.has(key) ? v : escapeHtml(v);
  });
}

/** Safe single-line token for a Content-Disposition filename. */
export function safeFilenamePart(v: string): string {
  return v.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 64);
}

/**
 * GAP-AI-COPILOT-DETAIL-02: a citation URL comes from the model's retrieval
 * payload, so it is untrusted. React does not block `javascript:` / `data:` /
 * `vbscript:` href values, and `target="_blank"` only narrows — it does not
 * remove — the risk (middle-click, copy-link, right-click-open still execute a
 * dangerous scheme). This returns the URL only when it parses and uses an
 * http(s) scheme, and `null` otherwise, so the caller renders plain text
 * instead of a live link for anything else.
 *
 * Relative URLs (no scheme) are intentionally rejected here: a citation is an
 * external retrieved document, never an in-app route, so there is no safe
 * same-origin base to resolve a relative value against.
 *
 *   safeHttpUrl("https://x.gov.in/a")   -> "https://x.gov.in/a"
 *   safeHttpUrl("http://x.gov.in")      -> "http://x.gov.in"
 *   safeHttpUrl("javascript:alert(1)")  -> null
 *   safeHttpUrl("data:text/html,x")     -> null
 *   safeHttpUrl("vbscript:msgbox(1)")   -> null
 *   safeHttpUrl("/relative/path")       -> null
 *   safeHttpUrl("")                      -> null
 */
export function safeHttpUrl(url: string | null | undefined): string | null {
  if (!url || typeof url !== "string") return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  return parsed.href;
}

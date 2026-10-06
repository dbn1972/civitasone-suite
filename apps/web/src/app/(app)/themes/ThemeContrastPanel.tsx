import type { ThemeTokenSummary } from "@civitasone/types";
import { Card } from "@/app/_components/ds";
import { contrast } from "@/lib/contrast";
import { isCssColour } from "@/lib/colour";

/** WCAG 2.x AA normal-text minimum. */
export const WCAG_AA_NORMAL = 4.5;

export interface ContrastPair {
  label: string;
  fgKey: string;
  bgKey: string;
  fg: string;
  bg: string;
  ratio: number;
  passes: boolean;
}

/** A six-digit hex this file can hand to lib/contrast (which expects #rrggbb). */
function toHex6(value: string): string | null {
  const v = value.trim();
  if (!/^#[0-9a-fA-F]+$/.test(v)) return null; // only hex is safe to expand here
  const body = v.slice(1);
  if (body.length === 3) return `#${body.split("").map((c) => c + c).join("")}`;
  if (body.length === 6) return `#${body}`;
  if (body.length === 4) return `#${body.slice(0, 3).split("").map((c) => c + c).join("")}`; // drop alpha
  if (body.length === 8) return `#${body.slice(0, 6)}`; // drop alpha
  return null;
}

function findToken(tokens: ThemeTokenSummary[], candidates: string[]): ThemeTokenSummary | undefined {
  for (const cand of candidates) {
    const hit = tokens.find((t) => t.key.toLowerCase() === cand);
    if (hit && isCssColour(String(hit.value ?? ""))) return hit;
  }
  // fall back to a key that *contains* the candidate word
  for (const cand of candidates) {
    const hit = tokens.find((t) => t.key.toLowerCase().includes(cand) && isCssColour(String(t.value ?? "")));
    if (hit) return hit;
  }
  return undefined;
}

/**
 * GAP-THEMES-TOKENS-03: derive the WCAG contrast pairs worth checking before a
 * publish — brand/primary text on the canvas/background surface, and body text
 * on that same surface. Only hex colours are evaluated (lib/contrast works on
 * hex); rgb()/hsl() tokens are shown by the table but skipped here rather than
 * reported with a wrong ratio.
 */
export function contrastPairs(tokens: ThemeTokenSummary[]): ContrastPair[] {
  const bg = findToken(tokens, ["surface.canvas", "color.background", "background", "surface", "canvas"]);
  const primary = findToken(tokens, ["brand.primary", "color.primary", "primary"]);
  const text = findToken(tokens, ["color.text", "text", "ink", "foreground"]);

  const pairs: ContrastPair[] = [];
  const add = (label: string, fg?: ThemeTokenSummary, bgTok?: ThemeTokenSummary) => {
    if (!fg || !bgTok) return;
    const fgHex = toHex6(String(fg.value));
    const bgHex = toHex6(String(bgTok.value));
    if (!fgHex || !bgHex) return;
    const ratio = Math.round(contrast(fgHex, bgHex) * 100) / 100;
    pairs.push({ label, fgKey: fg.key, bgKey: bgTok.key, fg: fgHex, bg: bgHex, ratio, passes: ratio >= WCAG_AA_NORMAL });
  };
  add("Primary on background", primary, bg);
  add("Body text on background", text, bg);
  return pairs;
}

export function ThemeContrastPanel({ tokens }: { tokens: ThemeTokenSummary[] }) {
  const pairs = contrastPairs(tokens);
  if (pairs.length === 0) return null;
  return (
    <Card title="Accessibility — colour contrast (WCAG AA)">
      <div className="pad">
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          {pairs.map((p) => (
            <li key={p.label} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14 }}>
              <span
                role="img"
                aria-label={`${p.fgKey} on ${p.bgKey} preview`}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 44,
                  height: 24,
                  borderRadius: 4,
                  background: p.bg,
                  color: p.fg,
                  border: "1px solid var(--line, #e2e8f0)",
                  fontWeight: 700,
                  flex: "0 0 auto",
                }}
              >
                Aa
              </span>
              <span style={{ flex: "1 1 auto" }}>{p.label}</span>
              <span style={{ fontFamily: "var(--mono, ui-monospace, monospace)" }}>{p.ratio.toFixed(2)}:1</span>
              <span
                style={{
                  fontWeight: 700,
                  color: p.passes ? "var(--good, #16a34a)" : "var(--bad, #dc2626)",
                }}
              >
                {p.passes ? "Passes AA" : "Fails AA"}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

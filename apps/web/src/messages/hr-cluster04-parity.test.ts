import { describe, it, expect } from "vitest";
import en from "@/messages/en.json";
import hi from "@/messages/hi.json";

/**
 * HR gap cluster 04 -- en/hi parity for the namespaces its pages read.
 *
 * i18n/request.ts loads ONLY the active locale file (no English fallback
 * merge), so a namespace or key that exists in en.json but not hi.json does not
 * fall back to English: next-intl prints the key path (e.g. "holidays.type.gazetted")
 * on the screen. hi.json used to lack `training`, `trainingDetail`,
 * `trainingFeedback`, `trainingNominations` entirely and 20 of `holidays`'
 * keys, so those Hindi pages were unreadable.
 *
 * (ta / te / kn are a deliberately partial restored subset -- see
 * restored-locales.test.ts -- and are not covered here.)
 */
type Tree = { [k: string]: string | Tree };

function leaves(node: Tree, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out[path] = v;
    else Object.assign(out, leaves(v, path));
  }
  return out;
}

/** Top-level ICU argument names: {name} and {name, plural, ...}. */
const args = (s: string) => [...new Set([...s.matchAll(/\{(\w+)\s*[,}]/g)].map((m) => m[1]!))].sort();

const NAMESPACES = [
  "holidays",
  "training",
  "trainingDetail",
  "trainingFeedback",
  "trainingNominations",
  "wfhRequests",
  "wfhForm",
] as const;

describe.each(NAMESPACES)("en/hi parity: %s", (ns) => {
  const enLeaves = leaves((en as unknown as Record<string, Tree>)[ns]!);
  const hiTree = (hi as unknown as Record<string, Tree>)[ns];

  it("exists in hi.json with every key en.json has", () => {
    expect(hiTree, `${ns} missing from hi.json`).toBeDefined();
    const hiLeaves = leaves(hiTree!);
    const missing = Object.keys(enLeaves).filter((k) => !(k in hiLeaves));
    expect(missing, `keys in en.json ${ns} but not hi.json`).toEqual([]);
  });

  it("has a non-empty Hindi value with the same ICU arguments for every key", () => {
    const hiLeaves = leaves(hiTree!);
    for (const [k, v] of Object.entries(enLeaves)) {
      expect(hiLeaves[k]?.trim().length, `${ns}.${k} empty in hi`).toBeGreaterThan(0);
      expect(args(hiLeaves[k]!), `${ns}.${k} ICU arguments differ`).toEqual(args(v));
    }
  });
});

describe("trainingFeedback copy (GAP-HR-TRAINING-FEEDBACK-03)", () => {
  it("no en string claims feedback is collected: the page lists completion scores", () => {
    const text = Object.values(leaves((en as unknown as Record<string, Tree>).trainingFeedback!)).join(" | ");
    expect(text).not.toMatch(/feedback is collected|collected at programme closure/i);
    expect((en as unknown as Record<string, Tree>).training!.completionResults).toBe("Completion Results");
    expect((en as unknown as Record<string, Tree>).training!.feedbackReports).toBeUndefined();
  });
});

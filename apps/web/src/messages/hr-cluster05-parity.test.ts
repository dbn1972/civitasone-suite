import { describe, it, expect } from "vitest";
import en from "./en.json";
import hi from "./hi.json";

/**
 * HR gap cluster 05 (training/new, training/nominations, certifications,
 * skills, competency): the Hindi catalogue must carry every English key of the
 * namespaces these screens read -- request.ts loads exactly one locale file
 * with no English fallback merge, so a namespace missing from hi.json renders
 * raw "namespace.key" paths on the Hindi UI. ICU argument names must match too,
 * or an interpolated value silently disappears from the Hindi sentence.
 * (ta/te/kn are intentionally partial -- see restored-locales.test.ts.)
 */
const NAMESPACES = ["trainingNew", "training", "trainingNominations", "certifications", "skills", "competency"] as const;

type Tree = { [key: string]: string | Tree };

function leaves(obj: Tree, prefix = ""): Array<[string, string]> {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === "string" ? [[`${prefix}${k}`, v] as [string, string]] : leaves(v, `${prefix}${k}.`),
  );
}

/** Top-level ICU argument names: `{max}`, `{days, plural, ...}`. */
function argNames(message: string): string[] {
  return [...message.matchAll(/\{\s*([A-Za-z][A-Za-z0-9_]*)\s*[,}]/g)].map((m) => m[1] as string).sort();
}

describe("hi.json parity for HR cluster 05 namespaces", () => {
  for (const ns of NAMESPACES) {
    describe(ns, () => {
      const enLeaves = leaves((en as unknown as Record<string, Tree>)[ns] as Tree);
      const hiMap = new Map(leaves((hi as unknown as Record<string, Tree>)[ns] as Tree));

      it("exists in hi.json", () => {
        expect((hi as unknown as Record<string, unknown>)[ns]).toBeTypeOf("object");
      });

      it("carries every English key with a non-empty string", () => {
        const missing = enLeaves.filter(([k]) => !hiMap.has(k)).map(([k]) => k);
        expect(missing).toEqual([]);
        const blank = enLeaves.filter(([k]) => (hiMap.get(k) ?? "").trim() === "").map(([k]) => k);
        expect(blank).toEqual([]);
      });

      it("keeps the same ICU arguments in every message", () => {
        const drift = enLeaves
          .filter(([k, v]) => JSON.stringify(argNames(v)) !== JSON.stringify(argNames(hiMap.get(k) ?? "")))
          .map(([k]) => k);
        expect(drift).toEqual([]);
      });
    });
  }

  it("actually translates (a Hindi value differs from the English one) for the screen titles", () => {
    expect(hi.trainingNew.title).not.toBe(en.trainingNew.title);
    expect(hi.trainingNominations.title).not.toBe(en.trainingNominations.title);
    expect(hi.certifications.title).not.toBe(en.certifications.title);
    expect(hi.training.title).not.toBe(en.training.title);
  });
});

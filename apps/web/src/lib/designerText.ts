"use client";

import { useTranslations } from "next-intl";
import en from "../../messages/en.json";

type Vars = Record<string, string | number>;
export type DesignerT = (key: string, vars?: Vars) => string;

function lookup(tree: unknown, key: string): string | undefined {
  let node: unknown = tree;
  for (const part of key.split(".")) {
    if (node && typeof node === "object" && part in (node as Record<string, unknown>)) {
      node = (node as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return typeof node === "string" ? node : undefined;
}

function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m));
}

/** English text straight from messages/en.json, for callers with no provider mounted. */
export function designerTextEn(key: string, vars?: Vars): string {
  return interpolate(lookup((en as Record<string, unknown>).designer, key) ?? key, vars);
}

/**
 * Localised designer wording from the `designer` namespace (en + hi). Falls back
 * to the English catalogue when no NextIntlClientProvider is mounted (component
 * tests render the designer without one), the same approach Skeleton takes.
 */
export function useDesignerT(): DesignerT {
  let t: DesignerT | null = null;
  try {
    t = useTranslations("designer") as unknown as DesignerT;
  } catch {
    t = null;
  }
  return (key, vars) => (t ? t(key, vars) : designerTextEn(key, vars));
}

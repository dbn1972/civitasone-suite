import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Section 8 NF-0 static-analysis helpers (pure fs; no DB, no network). */
export const SRC = resolve(fileURLToPath(new URL(".", import.meta.url)), "../src");

export function listTs(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listTs(p));
    else if (p.endsWith(".ts") && !p.endsWith(".test.ts") && !p.endsWith(".d.ts")) out.push(p);
  }
  return out.sort();
}

/** Remove block and line comments (string-literal-naive, which is enough for these patterns) but keep line count. */
export function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:\\])\/\/[^\n]*/g, (_m, pre: string) => pre);
}

export const rel = (p: string): string => relative(SRC, p).split("\\").join("/");
export const read = (p: string): string => readFileSync(p, "utf8");

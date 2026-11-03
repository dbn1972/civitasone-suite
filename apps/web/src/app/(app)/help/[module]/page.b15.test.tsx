/**
 * UAT b15 item 5: /help/ai answered "Guide not found" (L1 FAIL) although the AI page links to it ("How this works").
 * Twelve modules link to a guide that helpContent.ts does not have; they now get a short overview page (what the
 * module is for, a link to it, a link back to the Help Centre) instead of not-found. A real guide still wins, and a
 * slug that is neither a guide nor a linked module is still not found.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";

function lookup(messages: Record<string, unknown>, ns: string) {
  return (key: string, values?: Record<string, string>) => {
    let v: unknown = messages[ns];
    for (const part of key.split(".")) v = (v as Record<string, unknown> | undefined)?.[part];
    if (typeof v !== "string") throw new Error(`missing message ${ns}.${key}`);
    return v.replace(/\{(\w+)\}/g, (_, k: string) => values?.[k] ?? `{${k}}`);
  };
}
vi.mock("next-intl/server", () => ({
  getTranslations: async (ns: string) => lookup(enMessages as Record<string, unknown>, ns),
}));
const getEnabledModulesMock = vi.fn();
vi.mock("@/lib/moduleVisibility", () => ({
  getEnabledModules: () => getEnabledModulesMock(),
  isModuleEnabled: () => true,
}));
vi.mock("@/lib/auth/roleGuard", () => ({ getSessionRoles: () => ["super_admin"] }));
class NotFoundError extends Error {}
vi.mock("next/navigation", () => ({ notFound: () => { throw new NotFoundError("NEXT_NOT_FOUND"); } }));

import HelpModulePage, { generateMetadata } from "./page";
import { HELP_MODULES } from "@/lib/helpContent";
import { HELP_FALLBACK_TOPICS, getHelpFallback } from "@/lib/helpFallback";

const SRC = join(__dirname, "../../../..");
function* sourceFiles(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* sourceFiles(p);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) yield p;
  }
}

describe("help fallback overview (UAT b15 item 5)", () => {
  beforeEach(() => getEnabledModulesMock.mockResolvedValue(null));

  it("/help/ai shows an overview with a link to the module and back to the Help Centre, not Guide not found", async () => {
    render(await HelpModulePage({ params: Promise.resolve({ module: "ai" }) }));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("AI Assistant");
    expect(screen.getByText(/plain language/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open AI Assistant" })).toHaveAttribute("href", "/ai");
    expect(screen.getAllByRole("link", { name: /help centre/i })[0]).toHaveAttribute("href", "/help");
    expect(screen.queryByText(/guide not found/i)).not.toBeInTheDocument();
  });

  it("the metadata names the module", async () => {
    expect(await generateMetadata({ params: Promise.resolve({ module: "crm" }) })).toEqual({ title: "Help — CRM" });
  });

  it("a slug that is neither a guide nor a linked module is still not found", async () => {
    await expect(HelpModulePage({ params: Promise.resolve({ module: "no-such-module" }) })).rejects.toBeInstanceOf(NotFoundError);
    expect(getHelpFallback("toString")).toBeUndefined();
  });

  it("a full guide wins over the fallback list (no slug is in both)", () => {
    for (const m of HELP_MODULES) expect(HELP_FALLBACK_TOPICS[m.slug]).toBeUndefined();
  });

  it("every fallback topic has a name and summary in English and Hindi", () => {
    for (const slug of Object.keys(HELP_FALLBACK_TOPICS)) {
      for (const messages of [enMessages, hiMessages] as Array<Record<string, unknown>>) {
        expect(lookup(messages, "helpFallback")(`topics.${slug}.name`)).toBeTruthy();
        expect(lookup(messages, "helpFallback")(`topics.${slug}.summary`)).toBeTruthy();
      }
    }
  });

  it("every module help link in the app (help=\"<slug>\") opens a guide or an overview", () => {
    const known = new Set([...HELP_MODULES.map((m) => m.slug), ...Object.keys(HELP_FALLBACK_TOPICS)]);
    const missing: string[] = [];
    for (const file of sourceFiles(SRC)) {
      for (const m of readFileSync(file, "utf8").matchAll(/\bhelp="([^"]+)"/g)) {
        const slug = m[1]!;
        if (!/^[a-z0-9-]+(\/[a-z0-9-]+)*$/.test(slug)) continue; // a tooltip sentence, not a guide slug
        if (!known.has(slug)) missing.push(`${file.slice(SRC.length)}: ${slug}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
